/**
 * Google Calendar two-way sync engine (server-only).
 *
 * Features: multi-calendar selection, conflict resolution policy,
 * incremental sync tokens per calendar, retry with exponential backoff,
 * and a persisted sync activity log.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const CAL_BASE = "https://connector-gateway.lovable.dev/google_calendar/calendar/v3";
const PROVIDER_PREFIX = "google_calendar";

type Json = Record<string, unknown>;

export type ConflictPolicy = "remote" | "local" | "newest";

export type SyncSettings = {
  conflict_policy: ConflictPolicy;
  selected_calendar_ids: string[];
  auto_sync_enabled: boolean;
};

export type CalendarOption = {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  backgroundColor: string | null;
  selected: boolean;
};

type CalendarEvent = {
  id: string;
  status?: string;
  etag?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  updated?: string;
};

export type SyncResult = {
  pulled: number;
  updatedLocal: number;
  removedLocal: number;
  pushedNew: number;
  pushedUpdates: number;
  pushedDeletes: number;
  conflicts: number;
  skipped: number;
  retries: number;
  errors: string[];
  calendars: string[];
};

type Keys = { lovableKey: string; calendarKey: string };

const DEFAULT_SETTINGS: SyncSettings = {
  conflict_policy: "newest",
  selected_calendar_ids: ["primary"],
  auto_sync_enabled: true,
};

function keys(): Keys {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const calendarKey = process.env["GOOGLE_CALENDAR_API_KEY"];
  if (!lovableKey) throw new Error("Missing LOVABLE_API_KEY");
  if (!calendarKey) throw new Error("Google Calendar is not connected yet.");
  return { lovableKey, calendarKey };
}

/* ------------------------------------------------------------------ */
/* Logging                                                             */
/* ------------------------------------------------------------------ */

type Level = "info" | "warn" | "error";

async function logEvent(
  supabase: SupabaseClient,
  userId: string,
  level: Level,
  kind: string,
  message: string,
  opts?: { calendarId?: string | null; detail?: Json },
) {
  try {
    await supabase.from("sync_log").insert({
      user_id: userId,
      level,
      kind,
      message: message.slice(0, 500),
      calendar_id: opts?.calendarId ?? null,
      detail: opts?.detail ?? null,
    });
  } catch {
    /* logging must never break a sync */
  }
}

async function trimLog(supabase: SupabaseClient, userId: string) {
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  try {
    await supabase.from("sync_log").delete().eq("user_id", userId).lt("created_at", cutoff);
  } catch {
    /* best effort */
  }
}

/* ------------------------------------------------------------------ */
/* HTTP with retry + exponential backoff                               */
/* ------------------------------------------------------------------ */

const MAX_ATTEMPTS = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRetryableStatus(status: number) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export class CalendarApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "CalendarApiError";
    this.status = status;
  }
}

async function calFetch(
  path: string,
  k: Keys,
  init?: { method?: string; body?: Json },
  onRetry?: (attempt: number, reason: string) => void,
): Promise<{ status: number; json: any }> {
  let lastReason = "unknown error";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${CAL_BASE}${path}`, {
        method: init?.method ?? "GET",
        headers: {
          Authorization: `Bearer ${k.lovableKey}`,
          "X-Connection-Api-Key": k.calendarKey,
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
        },
        ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
      });

      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text };
      }

      // 404/410 are meaningful, not failures — the caller handles them.
      if (res.ok || res.status === 404 || res.status === 410) {
        return { status: res.status, json };
      }

      const msg = json?.error?.message ?? text.slice(0, 200) ?? res.statusText;
      lastReason = `${res.status} ${msg}`;

      if (!isRetryableStatus(res.status) || attempt === MAX_ATTEMPTS) {
        throw new CalendarApiError(res.status, describeStatus(res.status, msg));
      }
    } catch (err) {
      if (err instanceof CalendarApiError) throw err;
      lastReason = err instanceof Error ? err.message : String(err);
      if (attempt === MAX_ATTEMPTS) {
        throw new CalendarApiError(0, `Couldn't reach Google Calendar: ${lastReason}`);
      }
    }

    // Exponential backoff with jitter: ~0.5s, 1s, 2s.
    const delay = 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
    onRetry?.(attempt, lastReason);
    await sleep(delay);
  }

  throw new CalendarApiError(0, lastReason);
}

function describeStatus(status: number, msg: string) {
  if (status === 401 || status === 403)
    return `Google denied the request (${status}). Reconnect Google Calendar or check the granted permissions. ${msg}`;
  if (status === 429)
    return "Google rate-limited the sync. It will retry automatically in a moment.";
  if (status >= 500) return `Google Calendar is temporarily unavailable (${status}).`;
  return `Google Calendar error ${status}: ${msg}`;
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export async function getSettings(
  supabase: SupabaseClient,
  userId: string,
): Promise<SyncSettings> {
  const { data } = await supabase
    .from("sync_settings")
    .select("conflict_policy, selected_calendar_ids, auto_sync_enabled")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return { ...DEFAULT_SETTINGS };
  return {
    conflict_policy: (data.conflict_policy as ConflictPolicy) ?? "newest",
    selected_calendar_ids:
      data.selected_calendar_ids && data.selected_calendar_ids.length > 0
        ? data.selected_calendar_ids
        : ["primary"],
    auto_sync_enabled: data.auto_sync_enabled ?? true,
  };
}

export async function saveSettings(
  supabase: SupabaseClient,
  userId: string,
  patch: Partial<SyncSettings>,
): Promise<SyncSettings> {
  const current = await getSettings(supabase, userId);
  const next: SyncSettings = { ...current, ...patch };
  if (next.selected_calendar_ids.length === 0) next.selected_calendar_ids = [];
  const { error } = await supabase
    .from("sync_settings")
    .upsert({ user_id: userId, ...next }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
  return next;
}

export async function listCalendars(
  supabase: SupabaseClient,
  userId: string,
): Promise<CalendarOption[]> {
  const k = keys();
  const settings = await getSettings(supabase, userId);
  const { json } = await calFetch("/users/me/calendarList?maxResults=250", k);
  const items: any[] = json?.items ?? [];
  return items.map((c) => ({
    id: c.id,
    summary: c.summaryOverride ?? c.summary ?? c.id,
    primary: Boolean(c.primary),
    accessRole: c.accessRole ?? "reader",
    backgroundColor: c.backgroundColor ?? null,
    selected:
      settings.selected_calendar_ids.includes(c.id) ||
      (Boolean(c.primary) && settings.selected_calendar_ids.includes("primary")),
  }));
}

/* ------------------------------------------------------------------ */
/* Mapping                                                             */
/* ------------------------------------------------------------------ */

function eventToRow(ev: CalendarEvent) {
  const startsRaw = ev.start?.dateTime ?? ev.start?.date ?? null;
  const endsRaw = ev.end?.dateTime ?? ev.end?.date ?? null;
  if (!startsRaw) return null;
  const starts = new Date(startsRaw);
  if (Number.isNaN(starts.getTime())) return null;
  const ends = endsRaw ? new Date(endsRaw) : null;
  return {
    title: (ev.summary ?? "(untitled event)").slice(0, 200),
    starts_at: starts.toISOString(),
    ends_at: ends && !Number.isNaN(ends.getTime()) ? ends.toISOString() : null,
    location: ev.location ? ev.location.slice(0, 300) : null,
    notes: ev.description ? ev.description.slice(0, 2000) : null,
  };
}

function rowToEvent(row: {
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  notes: string | null;
}): Json {
  const start = new Date(row.starts_at);
  const end = row.ends_at ? new Date(row.ends_at) : new Date(start.getTime() + 30 * 60000);
  return {
    summary: row.title,
    description: row.notes ?? undefined,
    location: row.location ?? undefined,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };
}

const LOCAL_EDIT_GRACE_MS = 5000;

function hasLocalEdits(updatedAt: string | null, lastSyncedAt: string | null) {
  const updated = Date.parse(updatedAt ?? "");
  if (!Number.isFinite(updated)) return false;
  const synced = Date.parse(lastSyncedAt ?? "");
  if (!Number.isFinite(synced)) return true;
  return updated > synced + LOCAL_EDIT_GRACE_MS;
}

/* ------------------------------------------------------------------ */
/* Sync state per calendar                                             */
/* ------------------------------------------------------------------ */

function providerKey(calendarId: string) {
  return `${PROVIDER_PREFIX}:${calendarId}`;
}

async function readState(supabase: SupabaseClient, userId: string, calendarId: string) {
  const { data } = await supabase
    .from("sync_state")
    .select("sync_token, last_synced_at, pages_synced, events_seen, last_error")
    .eq("user_id", userId)
    .eq("provider", providerKey(calendarId))
    .maybeSingle();
  return data as
    | {
        sync_token: string | null;
        last_synced_at: string | null;
        pages_synced: number | null;
        events_seen: number | null;
        last_error: string | null;
      }
    | null;
}

async function writeState(
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
/* Pull                                                                */
/* ------------------------------------------------------------------ */

async function pullCalendar(
  supabase: SupabaseClient,
  userId: string,
  calendarId: string,
  k: Keys,
  settings: SyncSettings,
  result: SyncResult,
) {
  const state = await readState(supabase, userId, calendarId);
  let syncToken = state?.sync_token ?? null;
  let pageToken: string | null = null;
  let nextSyncToken: string | null = null;
  let pages = 0;
  let seen = 0;
  const encoded = encodeURIComponent(calendarId);

  while (pages < 10) {
    const params = new URLSearchParams({
      singleEvents: "true",
      showDeleted: "true",
      maxResults: "250",
    });
    if (syncToken) params.set("syncToken", syncToken);
    else {
      params.set("timeMin", new Date(Date.now() - 7 * 86400000).toISOString());
      params.set("timeMax", new Date(Date.now() + 120 * 86400000).toISOString());
      params.set("orderBy", "startTime");
    }
    if (pageToken) params.set("pageToken", pageToken);

    const { status, json } = await calFetch(
      `/calendars/${encoded}/events?${params.toString()}`,
      k,
      undefined,
      (attempt, reason) => {
        result.retries++;
        void logEvent(supabase, userId, "warn", "retry", `Retry ${attempt}: ${reason}`, {
          calendarId,
        });
      },
    );

    if (status === 410) {
      syncToken = null;
      pageToken = null;
      await writeState(supabase, userId, calendarId, { sync_token: null });
      await logEvent(supabase, userId, "warn", "sync_token", "Sync token expired — doing a full refresh.", {
        calendarId,
      });
      continue;
    }
    if (status === 404) {
      await logEvent(supabase, userId, "error", "calendar", "Calendar not found or no longer shared.", {
        calendarId,
      });
      result.errors.push(`Calendar ${calendarId} not found.`);
      return;
    }

    const items: CalendarEvent[] = json?.items ?? [];
    for (const ev of items) {
      result.pulled++;
      seen++;
      try {
        await applyRemoteEvent(supabase, userId, calendarId, ev, settings, result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result.errors.push(msg);
        await logEvent(supabase, userId, "error", "event", msg, {
          calendarId,
          detail: { eventId: ev.id },
        });
      }
    }

    pages++;
    pageToken = json?.nextPageToken ?? null;
    nextSyncToken = json?.nextSyncToken ?? nextSyncToken;
    if (!pageToken) break;
  }

  await writeState(supabase, userId, calendarId, {
    sync_token: nextSyncToken ?? syncToken,
    pages_synced: pages,
    events_seen: seen,
    last_error: null,
  });
}

async function applyRemoteEvent(
  supabase: SupabaseClient,
  userId: string,
  calendarId: string,
  ev: CalendarEvent,
  settings: SyncSettings,
  result: SyncResult,
) {
  const { data: existing } = await supabase
    .from("appointments")
    .select("id, updated_at, last_synced_at, title")
    .eq("user_id", userId)
    .eq("calendar_event_id", ev.id)
    .maybeSingle();

  if (ev.status === "cancelled") {
    if (!existing) return;
    if (settings.conflict_policy === "local" && hasLocalEdits(existing.updated_at, existing.last_synced_at)) {
      result.conflicts++;
      result.skipped++;
      await logEvent(
        supabase,
        userId,
        "warn",
        "conflict",
        `Kept local "${existing.title}" — it was deleted in Google but your edits win.`,
        { calendarId, detail: { eventId: ev.id } },
      );
      return;
    }
    await supabase.from("appointments").delete().eq("id", existing.id);
    await supabase
      .from("pending_calendar_deletions")
      .delete()
      .eq("user_id", userId)
      .eq("calendar_event_id", ev.id);
    result.removedLocal++;
    return;
  }

  const row = eventToRow(ev);
  if (!row) {
    result.skipped++;
    await logEvent(supabase, userId, "warn", "skipped", `Skipped "${ev.summary ?? ev.id}" — no usable start time.`, {
      calendarId,
      detail: { eventId: ev.id },
    });
    return;
  }

  const remoteUpdated = ev.updated ? Date.parse(ev.updated) : NaN;

  if (existing && hasLocalEdits(existing.updated_at, existing.last_synced_at)) {
    result.conflicts++;
    let remoteWins: boolean;
    if (settings.conflict_policy === "remote") remoteWins = true;
    else if (settings.conflict_policy === "local") remoteWins = false;
    else {
      const localUpdated = Date.parse(existing.updated_at ?? "");
      remoteWins = Number.isFinite(remoteUpdated) && remoteUpdated > localUpdated;
    }

    if (!remoteWins) {
      result.skipped++;
      await logEvent(
        supabase,
        userId,
        "warn",
        "conflict",
        `Conflict on "${existing.title}" — kept your local version (${settings.conflict_policy} wins).`,
        { calendarId, detail: { eventId: ev.id } },
      );
      return; // the push phase will send local changes up.
    }
    await logEvent(
      supabase,
      userId,
      "warn",
      "conflict",
      `Conflict on "${existing.title}" — Google's version was applied (${settings.conflict_policy} wins).`,
      { calendarId, detail: { eventId: ev.id } },
    );
  }

  const nowIso = new Date().toISOString();
  const { error } = await supabase.from("appointments").upsert(
    {
      user_id: userId,
      calendar_event_id: ev.id,
      calendar_id: calendarId,
      calendar_etag: ev.etag ?? null,
      source: "google_calendar",
      last_synced_at: nowIso,
      remote_updated_at: Number.isFinite(remoteUpdated) ? new Date(remoteUpdated).toISOString() : null,
      ...row,
    },
    { onConflict: "user_id,calendar_event_id" },
  );
  if (error) throw new Error(error.message);
  result.updatedLocal++;
}

/* ------------------------------------------------------------------ */
/* Push                                                                */
/* ------------------------------------------------------------------ */

async function push(
  supabase: SupabaseClient,
  userId: string,
  k: Keys,
  settings: SyncSettings,
  targetCalendar: string,
  result: SyncResult,
) {
  const onRetry = (attempt: number, reason: string) => {
    result.retries++;
    void logEvent(supabase, userId, "warn", "retry", `Retry ${attempt}: ${reason}`);
  };

  // 1. Deletions queued by the delete trigger.
  const { data: pending } = await supabase
    .from("pending_calendar_deletions")
    .select("id, calendar_event_id")
    .eq("user_id", userId)
    .limit(50);

  for (const p of pending ?? []) {
    if (settings.conflict_policy === "remote") {
      // Google is authoritative: drop the queued deletion instead of pushing it.
      await supabase.from("pending_calendar_deletions").delete().eq("id", p.id);
      result.skipped++;
      continue;
    }
    try {
      await calFetch(
        `/calendars/${encodeURIComponent(targetCalendar)}/events/${encodeURIComponent(p.calendar_event_id)}`,
        k,
        { method: "DELETE" },
        onRetry,
      );
      await supabase.from("pending_calendar_deletions").delete().eq("id", p.id);
      result.pushedDeletes++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(msg);
      await logEvent(supabase, userId, "error", "push_delete", msg, {
        detail: { eventId: p.calendar_event_id },
      });
    }
  }

  const horizon = new Date(Date.now() - 86400000).toISOString();

  // 2. Local appointments not yet on any calendar.
  const { data: fresh } = await supabase
    .from("appointments")
    .select("id, title, starts_at, ends_at, location, notes")
    .eq("user_id", userId)
    .is("calendar_event_id", null)
    .gte("starts_at", horizon)
    .limit(50);

  for (const row of fresh ?? []) {
    try {
      const { json } = await calFetch(
        `/calendars/${encodeURIComponent(targetCalendar)}/events`,
        k,
        { method: "POST", body: rowToEvent(row) },
        onRetry,
      );
      if (json?.id) {
        await supabase
          .from("appointments")
          .update({
            calendar_event_id: json.id,
            calendar_id: targetCalendar,
            calendar_etag: json.etag ?? null,
            last_synced_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        result.pushedNew++;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(msg);
      await logEvent(supabase, userId, "error", "push_create", msg, { detail: { title: row.title } });
    }
  }

  // 3. Locally edited appointments already linked to an event.
  if (settings.conflict_policy === "remote") return;

  const { data: linked } = await supabase
    .from("appointments")
    .select(
      "id, title, starts_at, ends_at, location, notes, calendar_event_id, calendar_id, updated_at, last_synced_at",
    )
    .eq("user_id", userId)
    .not("calendar_event_id", "is", null)
    .gte("starts_at", horizon)
    .limit(100);

  for (const row of linked ?? []) {
    if (!hasLocalEdits(row.updated_at, row.last_synced_at)) continue;
    const cal = row.calendar_id ?? targetCalendar;
    try {
      const { status, json } = await calFetch(
        `/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(row.calendar_event_id!)}`,
        k,
        { method: "PATCH", body: rowToEvent(row) },
        onRetry,
      );
      if (status === 404 || status === 410) {
        await supabase
          .from("appointments")
          .update({ calendar_event_id: null, calendar_etag: null })
          .eq("id", row.id);
        result.skipped++;
        continue;
      }
      await supabase
        .from("appointments")
        .update({ calendar_etag: json?.etag ?? null, last_synced_at: new Date().toISOString() })
        .eq("id", row.id);
      result.pushedUpdates++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(msg);
      await logEvent(supabase, userId, "error", "push_update", msg, { detail: { title: row.title } });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Entry points                                                        */
/* ------------------------------------------------------------------ */

export async function runCalendarSync(
  supabase: SupabaseClient,
  userId: string,
): Promise<SyncResult> {
  const k = keys();
  const settings = await getSettings(supabase, userId);
  const calendars = settings.selected_calendar_ids;

  const result: SyncResult = {
    pulled: 0,
    updatedLocal: 0,
    removedLocal: 0,
    pushedNew: 0,
    pushedUpdates: 0,
    pushedDeletes: 0,
    conflicts: 0,
    skipped: 0,
    retries: 0,
    errors: [],
    calendars,
  };

  if (calendars.length === 0) {
    await logEvent(supabase, userId, "warn", "run", "No calendars selected — nothing to sync.");
    return result;
  }

  for (const calendarId of calendars) {
    try {
      await pullCalendar(supabase, userId, calendarId, k, settings, result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(msg);
      await writeState(supabase, userId, calendarId, { last_error: msg.slice(0, 300) });
      await logEvent(supabase, userId, "error", "pull", msg, { calendarId });
    }
  }

  const target = calendars.includes("primary") ? "primary" : calendars[0]!;
  try {
    await push(supabase, userId, k, settings, target, result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push(msg);
    await logEvent(supabase, userId, "error", "push", msg);
  }

  await logEvent(
    supabase,
    userId,
    result.errors.length > 0 ? "warn" : "info",
    "run",
    `Sync finished: ${result.updatedLocal} in, ${result.pushedNew + result.pushedUpdates + result.pushedDeletes} out, ` +
      `${result.conflicts} conflict(s), ${result.skipped} skipped, ${result.retries} retr${result.retries === 1 ? "y" : "ies"}.`,
    { detail: { calendars } },
  );
  await trimLog(supabase, userId);

  return result;
}

export type SyncStatus = {
  connected: boolean;
  gmailConnected: boolean;
  lastSyncedAt: string | null;
  settings: SyncSettings;
  calendars: Array<{
    calendarId: string;
    hasSyncToken: boolean;
    lastSyncedAt: string | null;
    pagesSynced: number;
    eventsSeen: number;
    lastError: string | null;
  }>;
  log: Array<{
    id: string;
    level: Level;
    kind: string;
    message: string;
    calendar_id: string | null;
    created_at: string;
  }>;
};

export async function readSyncStatus(
  supabase: SupabaseClient,
  userId: string,
): Promise<SyncStatus> {
  const settings = await getSettings(supabase, userId);

  const { data: states } = await supabase
    .from("sync_state")
    .select("provider, calendar_id, sync_token, last_synced_at, pages_synced, events_seen, last_error")
    .eq("user_id", userId)
    .like("provider", `${PROVIDER_PREFIX}%`);

  const { data: log } = await supabase
    .from("sync_log")
    .select("id, level, kind, message, calendar_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(25);

  const calendars = (states ?? []).map((s: any) => ({
    calendarId: s.calendar_id ?? (String(s.provider).replace(`${PROVIDER_PREFIX}:`, "") || "primary"),
    hasSyncToken: Boolean(s.sync_token),
    lastSyncedAt: s.last_synced_at ?? null,
    pagesSynced: s.pages_synced ?? 0,
    eventsSeen: s.events_seen ?? 0,
    lastError: s.last_error ?? null,
  }));

  const lastSyncedAt =
    calendars
      .map((c) => c.lastSyncedAt)
      .filter(Boolean)
      .sort()
      .pop() ?? null;

  return {
    connected: Boolean(process.env["GOOGLE_CALENDAR_API_KEY"]),
    gmailConnected: Boolean(process.env["GOOGLE_MAIL_API_KEY"]),
    lastSyncedAt,
    settings,
    calendars,
    log: (log ?? []) as SyncStatus["log"],
  };
}

export async function clearSyncLog(supabase: SupabaseClient, userId: string) {
  await supabase.from("sync_log").delete().eq("user_id", userId);
  return { ok: true };
}

export async function resetSyncTokens(supabase: SupabaseClient, userId: string) {
  await supabase
    .from("sync_state")
    .update({ sync_token: null, last_error: null })
    .eq("user_id", userId)
    .like("provider", `${PROVIDER_PREFIX}%`);
  await logEvent(supabase, userId, "info", "sync_token", "Sync tokens cleared — next sync does a full refresh.");
  return { ok: true };
}
