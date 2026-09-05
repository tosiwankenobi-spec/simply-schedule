/**
 * Microsoft Outlook (Graph) two-way calendar sync engine — server only.
 *
 * Reads the per-user connection key from encrypted service-role storage and
 * calls Microsoft Graph through the Lovable connector gateway. Provider
 * tokens never enter this process; only the opaque lovack_* handle does, and
 * it never leaves the server. Graph responses are never logged verbatim —
 * only status codes, Microsoft error codes and request ids.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { callAsAppUser, disconnectAppUser } from "@/integrations/lovable/appUserConnector";
import {
  getConnectionKeyForUser,
  deleteConnectionForUser,
  getConnectionMetaForUser,
  markRevocationState,
  updateConnectionLabel,
} from "@/server/appUserConnections.server";
import {
  OUTLOOK_CONNECTOR_ID,
  OUTLOOK_PROVIDER,
  backoffDelayMs,
  graphErrorSummary,
  isAuthFailure,
  isDeltaResyncRequired,
  isRetryable,
  normalizeGraphEvent,
  outlookEventKey,
  readDeltaPage,
  rowToGraphEvent,
  type GraphEvent,
} from "./outlook";
import { logEvent } from "./calendar.server";

export const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";
const MAX_ATTEMPTS = 4;
const MAX_PAGES = 25;
const WINDOW_PAST_DAYS = 7;
const WINDOW_FUTURE_DAYS = 60;
const LOCK_KEY = `${OUTLOOK_PROVIDER}:sync`;
const LOCK_TTL_MS = 5 * 60 * 1000;
/** Sources this engine owns; imported .ics files are never touched. */
const OWNED_SOURCES = ["microsoft_outlook", "outlook_push"];

export type OutlookCalendar = {
  id: string;
  name: string;
  color: string | null;
  isDefault: boolean;
  canEdit: boolean;
  selected: boolean;
};

export type OutlookStatus = {
  connected: boolean;
  accountLabel: string | null;
  connectedAt: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  incomplete: boolean;
  needsReauth: boolean;
  revocationPending: boolean;
  exportEnabled: boolean;
  targetCalendarId: string | null;
  selectedCalendars: number;
  totalCalendars: number;
  localEventCount: number;
};

export type OutlookSyncResult = {
  ok: boolean;
  complete: boolean;
  pulled: number;
  updatedLocal: number;
  removedLocal: number;
  pushedNew: number;
  pushedUpdates: number;
  pushedDeletes: number;
  conflicts: number;
  skipped: number;
  retries: number;
  fullResyncs: number;
  errors: string[];
  calendars: string[];
};

function emptyResult(): OutlookSyncResult {
  return {
    ok: true,
    complete: true,
    pulled: 0,
    updatedLocal: 0,
    removedLocal: 0,
    pushedNew: 0,
    pushedUpdates: 0,
    pushedDeletes: 0,
    conflicts: 0,
    skipped: 0,
    retries: 0,
    fullResyncs: 0,
    errors: [],
    calendars: [],
  };
}

export class OutlookAuthError extends Error {
  constructor(message = "Your Microsoft connection needs to be renewed.") {
    super(message);
    this.name = "OutlookAuthError";
  }
}

export class OutlookBusyError extends Error {
  constructor(message = "An Outlook sync is already running. Please try again in a moment.") {
    super(message);
    this.name = "OutlookBusyError";
  }
}

/** Every Supabase write in this engine goes through here, so no failure is silent. */
function assertWrite(error: { message?: string } | null, what: string) {
  if (error) throw new Error(`${what} could not be saved. Please try again.`);
}

/* ------------------------------------------------------------------ */
/* Gateway plumbing                                                    */
/* ------------------------------------------------------------------ */

type GraphCall = {
  status: number;
  json: Record<string, unknown> | null;
  /** Raw text is kept in-process for delta detection only — never logged. */
  text: string;
  requestId: string | null;
  summary: string;
};

async function graphFetch(
  connectionKey: string,
  pathOrUrl: string,
  init?: RequestInit,
  onRetry?: (attempt: number, reason: string) => void,
): Promise<GraphCall> {
  // Graph paginates with absolute URLs; convert them back to gateway paths.
  const path = pathOrUrl.startsWith("http")
    ? pathOrUrl.replace(/^https:\/\/graph\.microsoft\.com\/v1\.0/, "")
    : pathOrUrl;

  let lastSummary = "Microsoft could not be reached.";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await callAsAppUser({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectionAPIKey: connectionKey,
      connectorId: OUTLOOK_CONNECTOR_ID,
      path,
      init: {
        ...init,
        headers: {
          "Content-Type": "application/json",
          // Ask Graph for UTC so zone-less timestamps are unambiguous.
          Prefer: 'outlook.timezone="UTC"',
          ...(init?.headers ?? {}),
        },
      },
    });
    const text = await res.text();
    const requestId = res.headers.get("request-id") ?? res.headers.get("client-request-id") ?? null;

    if (res.ok) {
      let json: Record<string, unknown> | null = null;
      try {
        json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
      } catch {
        json = null;
      }
      return { status: res.status, json, text, requestId, summary: "" };
    }

    const summary = graphErrorSummary(res.status, text, requestId);
    if (isAuthFailure(res.status)) throw new OutlookAuthError();
    if (isDeltaResyncRequired(res.status, text)) {
      return { status: res.status, json: null, text, requestId, summary };
    }
    if (!isRetryable(res.status) || attempt === MAX_ATTEMPTS) {
      return { status: res.status, json: null, text, requestId, summary };
    }

    lastSummary = summary;
    onRetry?.(attempt, summary);
    await new Promise((r) => setTimeout(r, backoffDelayMs(attempt)));
  }
  throw new Error(lastSummary);
}

async function requireKey(userId: string): Promise<string> {
  const key = await getConnectionKeyForUser(userId, OUTLOOK_CONNECTOR_ID);
  if (!key) throw new OutlookAuthError("Outlook is not connected for this account.");
  return key;
}

/* ------------------------------------------------------------------ */
/* Delta state                                                         */
/* ------------------------------------------------------------------ */

function providerKey(calendarId: string) {
  return `${OUTLOOK_PROVIDER}:${calendarId}`;
}

async function readDeltaLink(supabase: SupabaseClient, userId: string, calendarId: string) {
  const { data, error } = await supabase
    .from("sync_state")
    .select("sync_token, cursor, last_success_at, last_error")
    .eq("user_id", userId)
    .eq("provider", providerKey(calendarId))
    .maybeSingle();
  if (error) throw new Error("Your Outlook sync history could not be read.");
  return (data ?? null) as {
    sync_token: string | null;
    cursor: string | null;
    last_success_at: string | null;
    last_error: string | null;
  } | null;
}

type DeltaPatch = {
  sync_token?: string | null;
  /** Continuation link for a chain that has not finished yet. */
  cursor?: string | null;
  pages_synced?: number;
  events_seen?: number;
  last_error?: string | null;
  incomplete?: boolean;
  /** Only a fully finished, error-free pull records success. */
  success?: boolean;
};

async function writeDeltaState(
  supabase: SupabaseClient,
  userId: string,
  calendarId: string,
  patch: DeltaPatch,
) {
  const { success, ...rest } = patch;
  const nowIso = new Date().toISOString();
  const { error } = await supabase.from("sync_state").upsert(
    {
      user_id: userId,
      provider: providerKey(calendarId),
      calendar_id: calendarId,
      last_attempt_at: nowIso,
      ...(success ? { last_success_at: nowIso, last_synced_at: nowIso } : {}),
      ...rest,
    },
    { onConflict: "user_id,provider" },
  );
  assertWrite(error, "Your Outlook sync progress");
}

/**
 * Atomic, user-scoped mutual exclusion. The database claims the lock in a
 * single statement (stale locks older than the TTL are taken over), so two
 * concurrent runs can never both proceed. The token proves ownership on
 * release; the caller is always the session user — never an id from input.
 */
async function claimSyncLock(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await supabase.rpc("claim_sync_lock", {
    p_lock_key: LOCK_KEY,
    p_ttl_seconds: Math.round(LOCK_TTL_MS / 1000),
  });
  if (error) throw new Error("Your Outlook sync status could not be read.");
  const token = typeof data === "string" ? data : null;
  if (!token) throw new OutlookBusyError();
  return token;
}

async function releaseSyncLock(supabase: SupabaseClient, userId: string, token: string) {
  await supabase.rpc("release_sync_lock", { p_lock_key: LOCK_KEY, p_token: token });
}


/* ------------------------------------------------------------------ */
/* Calendars                                                           */
/* ------------------------------------------------------------------ */

export async function discoverCalendars(
  supabase: SupabaseClient,
  userId: string,
): Promise<OutlookCalendar[]> {
  const key = await requireKey(userId);
  const { json, summary } = await graphFetch(key, "/me/calendars?$top=50");
  if (!json) throw new Error(`Your Outlook calendars could not be listed. ${summary}`);

  const remote = (Array.isArray(json["value"]) ? json["value"] : []) as Array<
    Record<string, unknown>
  >;

  const { data: existing, error: readError } = await supabase
    .from("outlook_calendars")
    .select("calendar_id, selected")
    .eq("user_id", userId);
  if (readError) throw new Error("Your saved Outlook calendars could not be read.");
  const selectedMap = new Map(
    (existing ?? []).map((r) => [r.calendar_id as string, r.selected as boolean]),
  );
  const anySelection = (existing ?? []).some((r) => r.selected);

  const rows = remote
    .filter((c) => typeof c["id"] === "string")
    .map((c) => {
      const id = c["id"] as string;
      const isDefault = c["isDefaultCalendar"] === true;
      return {
        user_id: userId,
        account_id: "me",
        calendar_id: id,
        name: String(c["name"] ?? "Calendar").slice(0, 200),
        color: typeof c["hexColor"] === "string" ? (c["hexColor"] as string) : null,
        is_default: isDefault,
        can_edit: c["canEdit"] !== false,
        selected: selectedMap.get(id) ?? (!anySelection && isDefault),
      };
    });

  if (rows.length) {
    const { error } = await supabase
      .from("outlook_calendars")
      .upsert(rows, { onConflict: "user_id,account_id,calendar_id" });
    assertWrite(error, "Your Outlook calendar list");

    // Calendars removed in Outlook must stop syncing here too.
    const liveIds = rows.map((r) => r.calendar_id);
    const stale = (existing ?? [])
      .map((r) => r.calendar_id as string)
      .filter((id) => !liveIds.includes(id));
    for (const calendarId of stale) {
      const { error: dropError } = await supabase
        .from("outlook_calendars")
        .delete()
        .eq("user_id", userId)
        .eq("calendar_id", calendarId);
      assertWrite(dropError, "Your Outlook calendar list");
      await supabase
        .from("sync_state")
        .delete()
        .eq("user_id", userId)
        .eq("provider", providerKey(calendarId));
    }
  }

  return rows.map((r) => ({
    id: r.calendar_id,
    name: r.name,
    color: r.color,
    isDefault: r.is_default,
    canEdit: r.can_edit,
    selected: r.selected,
  }));
}

export async function setSelectedCalendars(
  supabase: SupabaseClient,
  userId: string,
  calendarIds: string[],
) {
  const { data: all, error } = await supabase
    .from("outlook_calendars")
    .select("calendar_id")
    .eq("user_id", userId);
  if (error) throw new Error("Your Outlook calendars could not be read.");
  const wanted = new Set(calendarIds);
  for (const row of all ?? []) {
    const { error: updateError } = await supabase
      .from("outlook_calendars")
      .update({ selected: wanted.has(row.calendar_id as string) })
      .eq("user_id", userId)
      .eq("calendar_id", row.calendar_id as string);
    assertWrite(updateError, "Your calendar choice");
  }
}

async function selectedCalendarIds(supabase: SupabaseClient, userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("outlook_calendars")
    .select("calendar_id")
    .eq("user_id", userId)
    .eq("selected", true);
  if (error) throw new Error("Your Outlook calendars could not be read.");
  return (data ?? []).map((r) => r.calendar_id as string);
}

/* ------------------------------------------------------------------ */
/* Pull                                                                */
/* ------------------------------------------------------------------ */

function deltaStartUrl(calendarId: string) {
  const start = new Date(Date.now() - WINDOW_PAST_DAYS * 86400000).toISOString();
  const end = new Date(Date.now() + WINDOW_FUTURE_DAYS * 86400000).toISOString();
  return `/me/calendars/${encodeURIComponent(calendarId)}/calendarView/delta?startDateTime=${start}&endDateTime=${end}&$top=50`;
}

async function pullCalendar(
  supabase: SupabaseClient,
  userId: string,
  calendarId: string,
  key: string,
  conflictPolicy: string,
  result: OutlookSyncResult,
) {
  const state = await readDeltaLink(supabase, userId, calendarId);
  const freshUrl = deltaStartUrl(calendarId);
  const startUrl = pullStartUrl(
    { syncToken: state?.sync_token ?? null, pendingNextLink: state?.cursor ?? null },
    freshUrl,
  );

  const walk = await walkDeltaPages({
    startUrl,
    freshUrl,
    maxPages: MAX_PAGES,
    fetchPage: async (url) => {
      const { status, json, text, summary } = await graphFetch(
        key,
        url,
        undefined,
        (attempt, reason) => {
          result.retries++;
          void logEvent(supabase, userId, "warn", "outlook_retry", `Retry ${attempt}: ${reason}`, {
            calendarId,
          });
        },
      );
      if (!json) {
        if (isDeltaResyncRequired(status, text)) {
          result.fullResyncs++;
          await writeDeltaState(supabase, userId, calendarId, { sync_token: null, cursor: null });
          await logEvent(
            supabase,
            userId,
            "warn",
            "outlook_resync",
            "Outlook asked for a fresh sync; re-importing this calendar's window.",
            { calendarId },
          );
          return { kind: "resync" };
        }
        return { kind: "error", message: summary || `Outlook sync failed (${status}).` };
      }
      const page = readDeltaPage(json);
      return {
        kind: "page",
        items: page.items,
        nextLink: page.nextLink,
        deltaLink: page.deltaLink,
      };
    },
    onItems: async (items) => {
      for (const raw of items) {
        await applyRemoteEvent(supabase, userId, calendarId, raw, conflictPolicy, result);
      }
    },
  });

  result.pulled += walk.seen;

  if (walk.error) {
    // Keep the continuation point so the next run resumes instead of restarting.
    if (walk.pendingNextLink) {
      await writeDeltaState(supabase, userId, calendarId, { cursor: walk.pendingNextLink });
    }
    throw new Error(walk.error);
  }

  // Hit the page ceiling with more waiting: this run is NOT a complete sync,
  // so the delta position and success timestamp must not move forward — but the
  // continuation link is stored so the next run picks up exactly where this one
  // stopped instead of replaying the same pages forever.
  if (walk.pendingNextLink) {
    result.complete = false;
    const message = "Outlook had more changes than one run can fetch; sync will continue shortly.";
    result.errors.push(message);
    await writeDeltaState(supabase, userId, calendarId, {
      cursor: walk.pendingNextLink,
      pages_synced: walk.pages,
      events_seen: walk.seen,
      incomplete: true,
      last_error: message,
    });
    await logEvent(supabase, userId, "warn", "outlook_incomplete", message, { calendarId });
    return;
  }

  await writeDeltaState(supabase, userId, calendarId, {
    sync_token: walk.deltaLink,
    cursor: null,
    pages_synced: walk.pages,
    events_seen: walk.seen,
    incomplete: false,
    last_error: null,
    success: true,
  });
}


const LOCAL_EDIT_GRACE_MS = 5000;
function hasLocalEdits(updatedAt: string | null, lastSyncedAt: string | null) {
  const updated = Date.parse(updatedAt ?? "");
  if (!Number.isFinite(updated)) return false;
  const synced = Date.parse(lastSyncedAt ?? "");
  if (!Number.isFinite(synced)) return true;
  return updated > synced + LOCAL_EDIT_GRACE_MS;
}

async function applyRemoteEvent(
  supabase: SupabaseClient,
  userId: string,
  calendarId: string,
  raw: GraphEvent,
  conflictPolicy: string,
  result: OutlookSyncResult,
) {
  const ev = normalizeGraphEvent(raw);
  if (!ev) {
    result.skipped++;
    return;
  }
  const eventKey = outlookEventKey("me", calendarId, ev.eventId);

  const { data: existing, error: readError } = await supabase
    .from("appointments")
    .select("id, updated_at, last_synced_at, title, household_id, household_visibility")
    .eq("user_id", userId)
    .eq("provider", OUTLOOK_PROVIDER)
    .eq("provider_account_id", "me")
    .eq("calendar_id", calendarId)
    .eq("calendar_event_id", eventKey)
    .maybeSingle();
  if (readError) throw new Error("Your schedule could not be read while syncing Outlook.");

  if (ev.removed) {
    if (!existing) return;
    if (conflictPolicy === "local" && hasLocalEdits(existing.updated_at, existing.last_synced_at)) {
      result.conflicts++;
      result.skipped++;
      return;
    }
    const { error: deleteError } = await supabase
      .from("appointments")
      .delete()
      .eq("id", existing.id);
    assertWrite(deleteError, "The removed Outlook event");
    const { error: queueError } = await supabase
      .from("pending_calendar_deletions")
      .delete()
      .eq("user_id", userId)
      .eq("provider", OUTLOOK_PROVIDER)
      .eq("calendar_event_id", eventKey);
    assertWrite(queueError, "The Outlook deletion queue");
    result.removedLocal++;
    return;
  }

  if (existing && hasLocalEdits(existing.updated_at, existing.last_synced_at)) {
    result.conflicts++;
    const remoteUpdated = Date.parse(ev.remote_updated_at ?? "");
    let remoteWins: boolean;
    if (conflictPolicy === "remote") remoteWins = true;
    else if (conflictPolicy === "local") remoteWins = false;
    else
      remoteWins =
        Number.isFinite(remoteUpdated) && remoteUpdated > Date.parse(existing.updated_at ?? "");
    if (!remoteWins) {
      result.skipped++;
      return;
    }
  }

  const nowIso = new Date().toISOString();
  const payload = {
    user_id: userId,
    title: ev.title,
    starts_at: ev.starts_at,
    ends_at: ev.ends_at,
    location: ev.location,
    notes: ev.notes,
    is_all_day: ev.is_all_day,
    timezone: ev.timezone,
    commitment_type: ev.commitment_type,
    source: "microsoft_outlook",
    provider: OUTLOOK_PROVIDER,
    provider_account_id: "me",
    calendar_id: calendarId,
    calendar_event_id: eventKey,
    external_id: eventKey,
    calendar_etag: ev.changeKey,
    remote_updated_at: ev.remote_updated_at,
    last_synced_at: nowIso,
    sync_status: "synced",
  };

  if (existing) {
    const { error } = await supabase.from("appointments").update(payload).eq("id", existing.id);
    assertWrite(error, "The Outlook event");
  } else {
    const { error } = await supabase.from("appointments").insert(payload);
    assertWrite(error, "The Outlook event");
  }
  result.updatedLocal++;
}

/* ------------------------------------------------------------------ */
/* Push                                                                */
/* ------------------------------------------------------------------ */

function parseEventKey(key: string): { calendarId: string; eventId: string } | null {
  const parts = key.split(":");
  if (parts.length < 4 || parts[0] !== OUTLOOK_PROVIDER) return null;
  return { calendarId: parts[2]!, eventId: parts.slice(3).join(":") };
}

async function push(
  supabase: SupabaseClient,
  userId: string,
  key: string,
  targetCalendar: string,
  conflictPolicy: string,
  exportEnabled: boolean,
  result: OutlookSyncResult,
) {
  // 1. Deletions queued for Outlook only.
  const { data: pending, error: pendingError } = await supabase
    .from("pending_calendar_deletions")
    .select("id, calendar_event_id")
    .eq("user_id", userId)
    .eq("provider", OUTLOOK_PROVIDER)
    .limit(50);
  if (pendingError) throw new Error("The Outlook deletion queue could not be read.");

  for (const p of pending ?? []) {
    const parsed = parseEventKey(p.calendar_event_id as string);
    if (!parsed || conflictPolicy === "remote") {
      const { error } = await supabase.from("pending_calendar_deletions").delete().eq("id", p.id);
      assertWrite(error, "The Outlook deletion queue");
      if (parsed) result.skipped++;
      continue;
    }
    const { status, summary } = await graphFetch(
      key,
      `/me/events/${encodeURIComponent(parsed.eventId)}`,
      { method: "DELETE" },
    );
    if (status < 300 || status === 404) {
      const { error } = await supabase.from("pending_calendar_deletions").delete().eq("id", p.id);
      assertWrite(error, "The Outlook deletion queue");
      result.pushedDeletes++;
    } else {
      result.ok = false;
      result.errors.push(summary);
      await logEvent(supabase, userId, "error", "outlook_push_delete", summary);
    }
  }

  const horizon = new Date(Date.now() - 86400000).toISOString();

  // 2. Chronos-V events the person explicitly chose to send to Outlook.
  if (exportEnabled) {
    const { data: fresh, error: freshError } = await supabase
      .from("appointments")
      .select("id, title, starts_at, ends_at, location, notes, is_all_day, timezone")
      .eq("user_id", userId)
      .eq("export_to_outlook", true)
      .is("calendar_event_id", null)
      .gte("starts_at", horizon)
      .limit(50);
    if (freshError) throw new Error("Your events waiting to be sent could not be read.");

    for (const row of fresh ?? []) {
      const { status, json, summary } = await graphFetch(
        key,
        `/me/calendars/${encodeURIComponent(targetCalendar)}/events`,
        { method: "POST", body: JSON.stringify(rowToGraphEvent(row as never)) },
      );
      const id = json && typeof json["id"] === "string" ? (json["id"] as string) : null;
      if (id) {
        const eventKey = outlookEventKey("me", targetCalendar, id);
        const { error } = await supabase
          .from("appointments")
          .update({
            provider: OUTLOOK_PROVIDER,
            provider_account_id: "me",
            calendar_id: targetCalendar,
            calendar_event_id: eventKey,
            external_id: eventKey,
            source: "outlook_push",
            last_synced_at: new Date().toISOString(),
            sync_status: "synced",
          })
          .eq("id", row.id);
        assertWrite(error, "The event sent to Outlook");
        result.pushedNew++;
      } else {
        result.ok = false;
        result.errors.push(summary || `Create failed (${status})`);
        await logEvent(
          supabase,
          userId,
          "error",
          "outlook_push_create",
          summary || `Create failed (${status})`,
        );
      }
    }
  }

  // 3. Local edits on events that already exist in Outlook.
  const { data: edited, error: editedError } = await supabase
    .from("appointments")
    .select(
      "id, title, starts_at, ends_at, location, notes, is_all_day, timezone, calendar_event_id, updated_at, last_synced_at",
    )
    .eq("user_id", userId)
    .eq("provider", OUTLOOK_PROVIDER)
    .in("source", OWNED_SOURCES)
    .not("calendar_event_id", "is", null)
    .gte("starts_at", horizon)
    .limit(50);
  if (editedError) throw new Error("Your edited Outlook events could not be read.");

  for (const row of edited ?? []) {
    if (!hasLocalEdits(row.updated_at as string, row.last_synced_at as string)) continue;
    if (conflictPolicy === "remote") {
      result.skipped++;
      continue;
    }
    const parsed = parseEventKey(row.calendar_event_id as string);
    if (!parsed) continue;
    const { status, summary } = await graphFetch(
      key,
      `/me/events/${encodeURIComponent(parsed.eventId)}`,
      { method: "PATCH", body: JSON.stringify(rowToGraphEvent(row as never)) },
    );
    if (status < 300) {
      const { error } = await supabase
        .from("appointments")
        .update({ last_synced_at: new Date().toISOString(), sync_status: "synced" })
        .eq("id", row.id);
      assertWrite(error, "The updated Outlook event");
      result.pushedUpdates++;
    } else {
      result.ok = false;
      result.errors.push(summary || `Update failed (${status})`);
      await logEvent(
        supabase,
        userId,
        "error",
        "outlook_push_update",
        summary || `Update failed (${status})`,
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

export async function runOutlookSync(
  supabase: SupabaseClient,
  userId: string,
): Promise<OutlookSyncResult> {
  const result = emptyResult();
  const key = await requireKey(userId);
  const lockToken = await claimSyncLock(supabase, userId);

  try {
    const { data: settings, error: settingsError } = await supabase
      .from("sync_settings")
      .select("conflict_policy, outlook_export_enabled, outlook_target_calendar_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (settingsError) throw new Error("Your sync settings could not be read.");
    const conflictPolicy = (settings?.conflict_policy as string) ?? "newest";
    const exportEnabled = settings?.outlook_export_enabled === true;

    let calendars = await selectedCalendarIds(supabase, userId);
    if (!calendars.length) {
      const discovered = await discoverCalendars(supabase, userId);
      calendars = discovered.filter((c) => c.selected).map((c) => c.id);
    }
    if (!calendars.length) {
      result.ok = false;
      result.complete = false;
      result.errors.push("No Outlook calendar is selected yet.");
      return result;
    }
    result.calendars = calendars;

    for (const calendarId of calendars) {
      try {
        await pullCalendar(supabase, userId, calendarId, key, conflictPolicy, result);
      } catch (e) {
        if (e instanceof OutlookAuthError) throw e;
        const msg = e instanceof Error ? e.message : "Outlook sync failed.";
        result.ok = false;
        result.complete = false;
        result.errors.push(msg);
        await writeDeltaState(supabase, userId, calendarId, {
          last_error: msg.slice(0, 300),
          incomplete: true,
        });
        await logEvent(supabase, userId, "error", "outlook_pull", msg, { calendarId });
      }
    }

    const target =
      (settings?.outlook_target_calendar_id as string | null) &&
      calendars.includes(settings?.outlook_target_calendar_id as string)
        ? (settings?.outlook_target_calendar_id as string)
        : calendars[0]!;

    try {
      await push(supabase, userId, key, target, conflictPolicy, exportEnabled, result);
    } catch (e) {
      if (e instanceof OutlookAuthError) throw e;
      const msg = e instanceof Error ? e.message : "Sending changes to Outlook failed.";
      result.ok = false;
      result.complete = false;
      result.errors.push(msg);
      await logEvent(supabase, userId, "error", "outlook_push", msg);
    }

    await logEvent(
      supabase,
      userId,
      result.ok ? "info" : "warn",
      "outlook_sync",
      result.ok
        ? `Outlook sync finished: ${result.updatedLocal} updated, ${result.removedLocal} removed, ${result.pushedNew + result.pushedUpdates} sent.`
        : `Outlook sync finished with problems: ${result.errors.length} issue(s).`,
    );
    return result;
  } finally {
    await releaseSyncLock(supabase, userId, lockToken);
  }
}

/* ------------------------------------------------------------------ */
/* Status / lifecycle                                                  */
/* ------------------------------------------------------------------ */

export async function readOutlookStatus(
  supabase: SupabaseClient,
  userId: string,
): Promise<OutlookStatus> {
  const [key, meta] = await Promise.all([
    getConnectionKeyForUser(userId, OUTLOOK_CONNECTOR_ID),
    getConnectionMetaForUser(userId, OUTLOOK_CONNECTOR_ID),
  ]);

  const { data: cals } = await supabase
    .from("outlook_calendars")
    .select("calendar_id, selected")
    .eq("user_id", userId);

  const { data: states } = await supabase
    .from("sync_state")
    .select("last_attempt_at, last_success_at, last_error, incomplete, provider")
    .eq("user_id", userId)
    .like("provider", `${OUTLOOK_PROVIDER}:%`);

  const { data: settings } = await supabase
    .from("sync_settings")
    .select("outlook_export_enabled, outlook_target_calendar_id")
    .eq("user_id", userId)
    .maybeSingle();

  const { count } = await supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("provider", OUTLOOK_PROVIDER)
    .in("source", OWNED_SOURCES);

  const calendarStates = (states ?? []).filter((s) => s.provider !== LOCK_KEY);
  const pick = (field: "last_attempt_at" | "last_success_at") =>
    calendarStates
      .map((s) => s[field] as string | null)
      .filter(Boolean)
      .sort()
      .pop() ?? null;

  const lastError = calendarStates.map((s) => s.last_error as string | null).find(Boolean) ?? null;

  return {
    connected: Boolean(key),
    accountLabel: meta?.account_label ?? null,
    connectedAt: meta?.created_at ?? null,
    lastAttemptAt: pick("last_attempt_at"),
    lastSuccessAt: pick("last_success_at"),
    lastError,
    incomplete: calendarStates.some((s) => s.incomplete === true),
    needsReauth: Boolean(lastError && /renew|401|403|unauthor/i.test(lastError)),
    revocationPending: meta?.revocation_pending === true,
    exportEnabled: settings?.outlook_export_enabled === true,
    targetCalendarId: (settings?.outlook_target_calendar_id as string | null) ?? null,
    selectedCalendars: (cals ?? []).filter((c) => c.selected).length,
    totalCalendars: (cals ?? []).length,
    localEventCount: count ?? 0,
  };
}

/** Reads the signed-in Microsoft account label for display (no tokens returned). */
export async function refreshAccountLabel(userId: string): Promise<string | null> {
  try {
    const key = await requireKey(userId);
    const { json } = await graphFetch(key, "/me?$select=displayName,userPrincipalName,mail");
    const label =
      (typeof json?.["mail"] === "string" && (json["mail"] as string)) ||
      (typeof json?.["userPrincipalName"] === "string" && (json["userPrincipalName"] as string)) ||
      (typeof json?.["displayName"] === "string" && (json["displayName"] as string)) ||
      null;
    if (label) await updateConnectionLabel(userId, OUTLOOK_CONNECTOR_ID, label);
    return label;
  } catch {
    return null;
  }
}

export type DisconnectOutcome = { revoked: boolean; message: string };

/**
 * Disconnect keeps every local copy of Outlook events, and only forgets the
 * stored connection when Microsoft access is confirmed gone. A failed
 * revocation is retained and reported so access is never silently stranded.
 */
export async function disconnectOutlook(
  supabase: SupabaseClient,
  userId: string,
): Promise<DisconnectOutcome> {
  const key = await getConnectionKeyForUser(userId, OUTLOOK_CONNECTOR_ID);

  if (key) {
    try {
      await disconnectAppUser({
        gatewayBaseUrl: GATEWAY_BASE_URL,
        connectionAPIKey: key,
        connectorId: OUTLOOK_CONNECTOR_ID,
      });
    } catch (e) {
      const raw = e instanceof Error ? e.message : "";
      // A connection Microsoft no longer knows about is already revoked.
      const alreadyGone = /\b404\b|not\s*found|unknown connection/i.test(raw);
      if (!alreadyGone) {
        await markRevocationState(userId, OUTLOOK_CONNECTOR_ID, {
          pending: true,
          error: "Microsoft did not confirm the disconnect.",
        });
        await logEvent(
          supabase,
          userId,
          "error",
          "outlook_disconnect",
          "Microsoft did not confirm the disconnect; the connection was kept so it can be retried.",
        );
        return {
          revoked: false,
          message:
            "Microsoft didn't confirm the disconnect, so Chronos-V kept the connection. Please try again in a moment.",
        };
      }
    }
  }

  await deleteConnectionForUser(userId, OUTLOOK_CONNECTOR_ID);

  const { error: stateError } = await supabase
    .from("sync_state")
    .delete()
    .eq("user_id", userId)
    .like("provider", `${OUTLOOK_PROVIDER}%`);
  assertWrite(stateError, "Your Outlook sync history");

  const { error: queueError } = await supabase
    .from("pending_calendar_deletions")
    .delete()
    .eq("user_id", userId)
    .eq("provider", OUTLOOK_PROVIDER);
  assertWrite(queueError, "The Outlook deletion queue");

  await logEvent(
    supabase,
    userId,
    "info",
    "outlook_disconnect",
    "Outlook disconnected. Local copies kept.",
  );
  return { revoked: true, message: "Outlook disconnected. Your existing events were kept." };
}

/** Explicit, separate destructive action — only synced/sent copies are removed. */
export async function deleteLocalOutlookCopies(supabase: SupabaseClient, userId: string) {
  const { count } = await supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("provider", OUTLOOK_PROVIDER)
    .in("source", OWNED_SOURCES);

  const { error } = await supabase
    .from("appointments")
    .delete()
    .eq("user_id", userId)
    .eq("provider", OUTLOOK_PROVIDER)
    .in("source", OWNED_SOURCES);
  assertWrite(error, "Your Outlook copies");

  const { error: queueError } = await supabase
    .from("pending_calendar_deletions")
    .delete()
    .eq("user_id", userId)
    .eq("provider", OUTLOOK_PROVIDER);
  assertWrite(queueError, "The Outlook deletion queue");

  return { removed: count ?? 0 };
}

/* ------------------------------------------------------------------ */
/* Explicit export controls                                            */
/* ------------------------------------------------------------------ */

export async function setOutlookExportSettings(
  supabase: SupabaseClient,
  userId: string,
  patch: { enabled?: boolean; targetCalendarId?: string | null },
) {
  const update: Record<string, unknown> = { user_id: userId };
  if (patch.enabled !== undefined) update["outlook_export_enabled"] = patch.enabled;
  if (patch.targetCalendarId !== undefined)
    update["outlook_target_calendar_id"] = patch.targetCalendarId;
  const { error } = await supabase.from("sync_settings").upsert(update, { onConflict: "user_id" });
  assertWrite(error, "Your Outlook sending preference");
}

export async function setAppointmentExport(
  supabase: SupabaseClient,
  userId: string,
  appointmentId: string,
  shouldExport: boolean,
) {
  const { error } = await supabase
    .from("appointments")
    .update({ export_to_outlook: shouldExport })
    .eq("user_id", userId)
    .eq("id", appointmentId)
    .is("calendar_event_id", null);
  assertWrite(error, "Your choice to send this event to Outlook");
}

export type ExportCandidate = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  is_all_day: boolean;
  export_to_outlook: boolean;
};

/** Upcoming Chronos-V-origin events that can be offered for export. */
export async function listExportCandidates(
  supabase: SupabaseClient,
  userId: string,
): Promise<ExportCandidate[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select("id, title, starts_at, ends_at, is_all_day, export_to_outlook")
    .eq("user_id", userId)
    .is("calendar_event_id", null)
    .gte("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(25);
  if (error) throw new Error("Your upcoming events could not be read.");
  return (data ?? []) as ExportCandidate[];
}
