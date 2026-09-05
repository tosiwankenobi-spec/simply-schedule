/**
 * Microsoft Outlook (Graph) two-way calendar sync engine — server only.
 *
 * Reads the per-user connection key from encrypted service-role storage and
 * calls Microsoft Graph through the Lovable connector gateway. Provider
 * tokens never enter this process; only the opaque lovack_* handle does, and
 * it never leaves the server.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { callAsAppUser, disconnectAppUser } from "@/integrations/lovable/appUserConnector";
import {
  getConnectionKeyForUser,
  deleteConnectionForUser,
  getConnectionMetaForUser,
  updateConnectionLabel,
} from "@/server/appUserConnections.server";
import {
  OUTLOOK_CONNECTOR_ID,
  OUTLOOK_PROVIDER,
  backoffDelayMs,
  isAuthFailure,
  isDeltaResyncRequired,
  isRetryable,
  normalizeGraphEvent,
  outlookEventKey,
  readDeltaPage,
  type GraphEvent,
} from "./outlook";
import { logEvent } from "./calendar.server";

export const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";
const MAX_ATTEMPTS = 4;
const MAX_PAGES = 25;
const WINDOW_PAST_DAYS = 7;
const WINDOW_FUTURE_DAYS = 60;

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
  lastSyncedAt: string | null;
  lastError: string | null;
  needsReauth: boolean;
  selectedCalendars: number;
  totalCalendars: number;
  localEventCount: number;
};

export type OutlookSyncResult = {
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

/* ------------------------------------------------------------------ */
/* Gateway plumbing                                                    */
/* ------------------------------------------------------------------ */

type GraphCall = { status: number; json: Record<string, unknown> | null; text: string };

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

  let lastReason = "unknown error";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await callAsAppUser({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectionAPIKey: connectionKey,
      connectorId: OUTLOOK_CONNECTOR_ID,
      path,
      init: {
        ...init,
        headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      },
    });
    const text = await res.text();

    if (res.ok) {
      let json: Record<string, unknown> | null = null;
      try {
        json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
      } catch {
        json = null;
      }
      return { status: res.status, json, text };
    }

    if (isAuthFailure(res.status)) throw new OutlookAuthError();
    if (isDeltaResyncRequired(res.status, text)) return { status: res.status, json: null, text };
    if (!isRetryable(res.status) || attempt === MAX_ATTEMPTS) {
      return { status: res.status, json: null, text };
    }

    lastReason = `Microsoft responded ${res.status}`;
    onRetry?.(attempt, lastReason);
    await new Promise((r) => setTimeout(r, backoffDelayMs(attempt)));
  }
  throw new Error(lastReason);
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
  const { data } = await supabase
    .from("sync_state")
    .select("sync_token, last_synced_at, last_error")
    .eq("user_id", userId)
    .eq("provider", providerKey(calendarId))
    .maybeSingle();
  return (data ?? null) as {
    sync_token: string | null;
    last_synced_at: string | null;
    last_error: string | null;
  } | null;
}

async function writeDeltaState(
  supabase: SupabaseClient,
  userId: string,
  calendarId: string,
  patch: {
    sync_token?: string | null;
    pages_synced?: number;
    events_seen?: number;
    last_error?: string | null;
  },
) {
  await supabase.from("sync_state").upsert(
    {
      user_id: userId,
      provider: providerKey(calendarId),
      calendar_id: calendarId,
      last_synced_at: new Date().toISOString(),
      ...patch,
    },
    { onConflict: "user_id,provider" },
  );
}

/* ------------------------------------------------------------------ */
/* Calendars                                                           */
/* ------------------------------------------------------------------ */

export async function discoverCalendars(
  supabase: SupabaseClient,
  userId: string,
): Promise<OutlookCalendar[]> {
  const key = await requireKey(userId);
  const { status, json, text } = await graphFetch(key, "/me/calendars?$top=50");
  if (!json)
    throw new Error(`Outlook calendars could not be listed (${status}). ${text.slice(0, 120)}`);

  const remote = (Array.isArray(json["value"]) ? json["value"] : []) as Array<
    Record<string, unknown>
  >;

  const { data: existing } = await supabase
    .from("outlook_calendars")
    .select("calendar_id, selected")
    .eq("user_id", userId);
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
    if (error) throw new Error("Could not save your Outlook calendar list.");
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
  const { data: all } = await supabase
    .from("outlook_calendars")
    .select("calendar_id")
    .eq("user_id", userId);
  const wanted = new Set(calendarIds);
  for (const row of all ?? []) {
    await supabase
      .from("outlook_calendars")
      .update({ selected: wanted.has(row.calendar_id as string) })
      .eq("user_id", userId)
      .eq("calendar_id", row.calendar_id as string);
  }
}

async function selectedCalendarIds(supabase: SupabaseClient, userId: string): Promise<string[]> {
  const { data } = await supabase
    .from("outlook_calendars")
    .select("calendar_id")
    .eq("user_id", userId)
    .eq("selected", true);
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
  let url = state?.sync_token || deltaStartUrl(calendarId);
  let pages = 0;
  let seen = 0;
  let deltaLink: string | null = null;
  let usedFallback = false;

  while (pages < MAX_PAGES) {
    const { status, json, text } = await graphFetch(key, url, undefined, (attempt, reason) => {
      result.retries++;
      void logEvent(supabase, userId, "warn", "outlook_retry", `Retry ${attempt}: ${reason}`, {
        calendarId,
      });
    });

    if (!json) {
      if (isDeltaResyncRequired(status, text) && !usedFallback) {
        usedFallback = true;
        result.fullResyncs++;
        await writeDeltaState(supabase, userId, calendarId, { sync_token: null });
        await logEvent(
          supabase,
          userId,
          "warn",
          "outlook_resync",
          "Outlook asked for a fresh sync; re-importing this calendar's window.",
          { calendarId },
        );
        url = deltaStartUrl(calendarId);
        continue;
      }
      throw new Error(`Outlook sync failed (${status}).`);
    }

    const page = readDeltaPage(json);
    pages++;
    for (const raw of page.items) {
      seen++;
      await applyRemoteEvent(supabase, userId, calendarId, raw, conflictPolicy, result);
    }
    if (page.deltaLink) {
      deltaLink = page.deltaLink;
      break;
    }
    if (!page.nextLink) break;
    url = page.nextLink;
  }

  result.pulled += seen;
  await writeDeltaState(supabase, userId, calendarId, {
    sync_token: deltaLink,
    pages_synced: pages,
    events_seen: seen,
    last_error: null,
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

  const { data: existing } = await supabase
    .from("appointments")
    .select("id, updated_at, last_synced_at, title, household_id, household_visibility")
    .eq("user_id", userId)
    .eq("provider", OUTLOOK_PROVIDER)
    .eq("calendar_event_id", eventKey)
    .maybeSingle();

  if (ev.removed) {
    if (!existing) return;
    if (conflictPolicy === "local" && hasLocalEdits(existing.updated_at, existing.last_synced_at)) {
      result.conflicts++;
      result.skipped++;
      return;
    }
    await supabase.from("appointments").delete().eq("id", existing.id);
    await supabase
      .from("pending_calendar_deletions")
      .delete()
      .eq("user_id", userId)
      .eq("provider", OUTLOOK_PROVIDER)
      .eq("calendar_event_id", eventKey);
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
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("appointments").insert(payload);
    if (error) throw new Error(error.message);
  }
  result.updatedLocal++;
}

/* ------------------------------------------------------------------ */
/* Push                                                                */
/* ------------------------------------------------------------------ */

function rowToGraphEvent(row: {
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  notes: string | null;
}) {
  const start = new Date(row.starts_at);
  const end = row.ends_at ? new Date(row.ends_at) : new Date(start.getTime() + 30 * 60000);
  return {
    subject: row.title,
    body: { contentType: "Text", content: row.notes ?? "" },
    location: row.location ? { displayName: row.location } : undefined,
    start: { dateTime: start.toISOString().replace(/Z$/, ""), timeZone: "UTC" },
    end: { dateTime: end.toISOString().replace(/Z$/, ""), timeZone: "UTC" },
  };
}

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
  result: OutlookSyncResult,
) {
  // 1. Deletions queued for Outlook only.
  const { data: pending } = await supabase
    .from("pending_calendar_deletions")
    .select("id, calendar_event_id")
    .eq("user_id", userId)
    .eq("provider", OUTLOOK_PROVIDER)
    .limit(50);

  for (const p of pending ?? []) {
    const parsed = parseEventKey(p.calendar_event_id as string);
    if (!parsed) {
      await supabase.from("pending_calendar_deletions").delete().eq("id", p.id);
      continue;
    }
    if (conflictPolicy === "remote") {
      await supabase.from("pending_calendar_deletions").delete().eq("id", p.id);
      result.skipped++;
      continue;
    }
    const { status, text } = await graphFetch(
      key,
      `/me/events/${encodeURIComponent(parsed.eventId)}`,
      {
        method: "DELETE",
      },
    );
    if (status < 300 || status === 404) {
      await supabase.from("pending_calendar_deletions").delete().eq("id", p.id);
      result.pushedDeletes++;
    } else {
      result.errors.push(`Delete failed (${status})`);
      await logEvent(
        supabase,
        userId,
        "error",
        "outlook_push_delete",
        `Delete failed (${status}). ${text.slice(0, 120)}`,
      );
    }
  }

  // 2. Local-origin appointments that have never reached Outlook.
  const horizon = new Date(Date.now() - 86400000).toISOString();
  const { data: fresh } = await supabase
    .from("appointments")
    .select("id, title, starts_at, ends_at, location, notes")
    .eq("user_id", userId)
    .eq("source", "outlook_push")
    .is("calendar_event_id", null)
    .gte("starts_at", horizon)
    .limit(50);

  for (const row of fresh ?? []) {
    const { status, json } = await graphFetch(
      key,
      `/me/calendars/${encodeURIComponent(targetCalendar)}/events`,
      { method: "POST", body: JSON.stringify(rowToGraphEvent(row as never)) },
    );
    const id = json && typeof json["id"] === "string" ? (json["id"] as string) : null;
    if (id) {
      const eventKey = outlookEventKey("me", targetCalendar, id);
      await supabase
        .from("appointments")
        .update({
          provider: OUTLOOK_PROVIDER,
          provider_account_id: "me",
          calendar_id: targetCalendar,
          calendar_event_id: eventKey,
          external_id: eventKey,
          last_synced_at: new Date().toISOString(),
          sync_status: "synced",
        })
        .eq("id", row.id);
      result.pushedNew++;
    } else {
      result.errors.push(`Create failed (${status})`);
    }
  }

  // 3. Local edits on Outlook-origin events.
  const { data: edited } = await supabase
    .from("appointments")
    .select(
      "id, title, starts_at, ends_at, location, notes, calendar_event_id, updated_at, last_synced_at, commitment_type",
    )
    .eq("user_id", userId)
    .eq("provider", OUTLOOK_PROVIDER)
    .not("calendar_event_id", "is", null)
    .gte("starts_at", horizon)
    .limit(50);

  for (const row of edited ?? []) {
    if (!hasLocalEdits(row.updated_at as string, row.last_synced_at as string)) continue;
    if (conflictPolicy === "remote") {
      result.skipped++;
      continue;
    }
    const parsed = parseEventKey(row.calendar_event_id as string);
    if (!parsed) continue;
    const { status, text } = await graphFetch(
      key,
      `/me/events/${encodeURIComponent(parsed.eventId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(rowToGraphEvent(row as never)),
      },
    );
    if (status < 300) {
      await supabase
        .from("appointments")
        .update({ last_synced_at: new Date().toISOString(), sync_status: "synced" })
        .eq("id", row.id);
      result.pushedUpdates++;
    } else {
      result.errors.push(`Update failed (${status})`);
      await logEvent(
        supabase,
        userId,
        "error",
        "outlook_push_update",
        `Update failed (${status}). ${text.slice(0, 120)}`,
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

  const { data: settings } = await supabase
    .from("sync_settings")
    .select("conflict_policy")
    .eq("user_id", userId)
    .maybeSingle();
  const conflictPolicy = (settings?.conflict_policy as string) ?? "newest";

  let calendars = await selectedCalendarIds(supabase, userId);
  if (!calendars.length) {
    const discovered = await discoverCalendars(supabase, userId);
    calendars = discovered.filter((c) => c.selected).map((c) => c.id);
  }
  if (!calendars.length) {
    result.errors.push("No Outlook calendar is selected yet.");
    return result;
  }
  result.calendars = calendars;

  for (const calendarId of calendars) {
    try {
      await pullCalendar(supabase, userId, calendarId, key, conflictPolicy, result);
    } catch (e) {
      if (e instanceof OutlookAuthError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(msg);
      await writeDeltaState(supabase, userId, calendarId, { last_error: msg.slice(0, 300) });
      await logEvent(supabase, userId, "error", "outlook_pull", msg, { calendarId });
    }
  }

  try {
    await push(supabase, userId, key, calendars[0]!, conflictPolicy, result);
  } catch (e) {
    if (e instanceof OutlookAuthError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push(msg);
    await logEvent(supabase, userId, "error", "outlook_push", msg);
  }

  await logEvent(
    supabase,
    userId,
    result.errors.length ? "warn" : "info",
    "outlook_sync",
    `Outlook sync finished: ${result.updatedLocal} updated, ${result.removedLocal} removed, ${result.pushedNew + result.pushedUpdates} sent.`,
  );
  return result;
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
    .select("last_synced_at, last_error")
    .eq("user_id", userId)
    .like("provider", `${OUTLOOK_PROVIDER}%`);

  const { count } = await supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("provider", OUTLOOK_PROVIDER);

  const lastSyncedAt =
    (states ?? [])
      .map((s) => s.last_synced_at as string | null)
      .filter(Boolean)
      .sort()
      .pop() ?? null;
  const lastError = (states ?? []).map((s) => s.last_error as string | null).find(Boolean) ?? null;

  return {
    connected: Boolean(key),
    accountLabel: meta?.account_label ?? null,
    connectedAt: meta?.created_at ?? null,
    lastSyncedAt,
    lastError,
    needsReauth: Boolean(lastError && /renew|401|403|unauthor/i.test(lastError)),
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

/** Disconnect keeps every local copy of Outlook events. */
export async function disconnectOutlook(supabase: SupabaseClient, userId: string) {
  const key = await getConnectionKeyForUser(userId, OUTLOOK_CONNECTOR_ID);
  if (key) {
    try {
      await disconnectAppUser({
        gatewayBaseUrl: GATEWAY_BASE_URL,
        connectionAPIKey: key,
        connectorId: OUTLOOK_CONNECTOR_ID,
      });
    } catch {
      /* the local record is removed regardless */
    }
  }
  await deleteConnectionForUser(userId, OUTLOOK_CONNECTOR_ID);
  await supabase
    .from("sync_state")
    .delete()
    .eq("user_id", userId)
    .like("provider", `${OUTLOOK_PROVIDER}%`);
  await supabase
    .from("pending_calendar_deletions")
    .delete()
    .eq("user_id", userId)
    .eq("provider", OUTLOOK_PROVIDER);
  await logEvent(
    supabase,
    userId,
    "info",
    "outlook_disconnect",
    "Outlook disconnected. Local copies kept.",
  );
}

/** Explicit, separate destructive action. */
export async function deleteLocalOutlookCopies(supabase: SupabaseClient, userId: string) {
  const { count } = await supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("provider", OUTLOOK_PROVIDER);
  await supabase
    .from("appointments")
    .delete()
    .eq("user_id", userId)
    .eq("provider", OUTLOOK_PROVIDER);
  await supabase
    .from("pending_calendar_deletions")
    .delete()
    .eq("user_id", userId)
    .eq("provider", OUTLOOK_PROVIDER);
  return { removed: count ?? 0 };
}
