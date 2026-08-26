/**
 * Google Calendar two-way sync engine (server-only).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const CAL_BASE = "https://connector-gateway.lovable.dev/google_calendar/calendar/v3";
const CALENDAR_ID = "primary";
const PROVIDER = "google_calendar";

type Json = Record<string, unknown>;

type CalendarEvent = {
  id: string;
  status?: string;
  etag?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  updated?: string;
};

export type SyncResult = {
  pulled: number;
  updatedLocal: number;
  removedLocal: number;
  pushedNew: number;
  pushedUpdates: number;
  pushedDeletes: number;
  errors: string[];
};

type Keys = { lovableKey: string; calendarKey: string };

function keys(): Keys {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const calendarKey = process.env["GOOGLE_CALENDAR_API_KEY"];
  if (!lovableKey) throw new Error("Missing LOVABLE_API_KEY");
  if (!calendarKey) throw new Error("Google Calendar is not connected.");
  return { lovableKey, calendarKey };
}

async function calFetch(
  path: string,
  k: Keys,
  init?: { method?: string; body?: Json },
): Promise<{ status: number; json: any }> {
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
  if (!res.ok && res.status !== 410 && res.status !== 404) {
    const msg = json?.error?.message ?? text.slice(0, 200);
    throw new Error(`Google Calendar ${res.status}: ${msg}`);
  }
  return { status: res.status, json };
}

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

async function getSyncToken(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase
    .from("sync_state")
    .select("sync_token, last_synced_at")
    .eq("user_id", userId)
    .eq("provider", PROVIDER)
    .maybeSingle();
  return (data ?? null) as { sync_token: string | null; last_synced_at: string | null } | null;
}

async function saveSyncToken(supabase: SupabaseClient, userId: string, token: string | null) {
  await supabase.from("sync_state").upsert(
    {
      user_id: userId,
      provider: PROVIDER,
      sync_token: token,
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider" },
  );
}

/** Pull remote changes into the local schedule. */
async function pull(supabase: SupabaseClient, userId: string, k: Keys, result: SyncResult) {
  const state = await getSyncToken(supabase, userId);
  let syncToken = state?.sync_token ?? null;
  let pageToken: string | null = null;
  let nextSyncToken: string | null = null;
  let guard = 0;

  while (guard++ < 10) {
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
      `/calendars/${CALENDAR_ID}/events?${params.toString()}`,
      k,
    );

    if (status === 410) {
      // Sync token expired — restart with a full window.
      syncToken = null;
      pageToken = null;
      await saveSyncToken(supabase, userId, null);
      continue;
    }

    const items: CalendarEvent[] = json?.items ?? [];
    for (const ev of items) {
      result.pulled++;
      try {
        if (ev.status === "cancelled") {
          const { data: gone } = await supabase
            .from("appointments")
            .delete()
            .eq("user_id", userId)
            .eq("calendar_event_id", ev.id)
            .select("id");
          if (gone && gone.length > 0) result.removedLocal++;
          // Don't echo this deletion back to Google.
          await supabase
            .from("pending_calendar_deletions")
            .delete()
            .eq("user_id", userId)
            .eq("calendar_event_id", ev.id);
          continue;
        }
        const row = eventToRow(ev);
        if (!row) continue;
        const nowIso = new Date().toISOString();
        const { error } = await supabase.from("appointments").upsert(
          {
            user_id: userId,
            calendar_event_id: ev.id,
            calendar_etag: ev.etag ?? null,
            source: "google_calendar",
            last_synced_at: nowIso,
            ...row,
          },
          { onConflict: "user_id,calendar_event_id" },
        );
        if (error) result.errors.push(error.message);
        else result.updatedLocal++;
      } catch (e) {
        result.errors.push(e instanceof Error ? e.message : String(e));
      }
    }

    pageToken = json?.nextPageToken ?? null;
    nextSyncToken = json?.nextSyncToken ?? nextSyncToken;
    if (!pageToken) break;
  }

  if (nextSyncToken) await saveSyncToken(supabase, userId, nextSyncToken);
  else await saveSyncToken(supabase, userId, syncToken);
}

/** Push local creates, edits and deletes up to Google Calendar. */
async function push(supabase: SupabaseClient, userId: string, k: Keys, result: SyncResult) {
  // 1. Deletions queued by the delete trigger.
  const { data: pending } = await supabase
    .from("pending_calendar_deletions")
    .select("id, calendar_event_id")
    .eq("user_id", userId)
    .limit(50);

  for (const p of pending ?? []) {
    try {
      await calFetch(`/calendars/${CALENDAR_ID}/events/${encodeURIComponent(p.calendar_event_id)}`, k, {
        method: "DELETE",
      });
      result.pushedDeletes++;
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : String(e));
      continue;
    }
    await supabase.from("pending_calendar_deletions").delete().eq("id", p.id);
  }

  // 2. Local appointments not yet on the calendar.
  const horizon = new Date(Date.now() - 86400000).toISOString();
  const { data: fresh } = await supabase
    .from("appointments")
    .select("id, title, starts_at, ends_at, location, notes")
    .eq("user_id", userId)
    .is("calendar_event_id", null)
    .gte("starts_at", horizon)
    .limit(50);

  for (const row of fresh ?? []) {
    try {
      const { json } = await calFetch(`/calendars/${CALENDAR_ID}/events`, k, {
        method: "POST",
        body: rowToEvent(row),
      });
      if (json?.id) {
        await supabase
          .from("appointments")
          .update({
            calendar_event_id: json.id,
            calendar_etag: json.etag ?? null,
            last_synced_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        result.pushedNew++;
      }
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  // 3. Locally edited appointments already linked to an event.
  const { data: linked } = await supabase
    .from("appointments")
    .select("id, title, starts_at, ends_at, location, notes, calendar_event_id, updated_at, last_synced_at")
    .eq("user_id", userId)
    .not("calendar_event_id", "is", null)
    .gte("starts_at", horizon)
    .limit(100);

  for (const row of linked ?? []) {
    const updated = Date.parse(row.updated_at ?? "");
    const synced = Date.parse(row.last_synced_at ?? "");
    if (!Number.isFinite(updated)) continue;
    // 5s grace so a sync-write isn't mistaken for a local edit.
    if (Number.isFinite(synced) && updated <= synced + 5000) continue;
    try {
      const { json } = await calFetch(
        `/calendars/${CALENDAR_ID}/events/${encodeURIComponent(row.calendar_event_id!)}`,
        k,
        { method: "PATCH", body: rowToEvent(row) },
      );
      await supabase
        .from("appointments")
        .update({
          calendar_etag: json?.etag ?? null,
          last_synced_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      result.pushedUpdates++;
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
}

export async function runCalendarSync(
  supabase: SupabaseClient,
  userId: string,
): Promise<SyncResult> {
  const k = keys();
  const result: SyncResult = {
    pulled: 0,
    updatedLocal: 0,
    removedLocal: 0,
    pushedNew: 0,
    pushedUpdates: 0,
    pushedDeletes: 0,
    errors: [],
  };
  await push(supabase, userId, k, result);
  await pull(supabase, userId, k, result);
  return result;
}

export async function readSyncStatus(supabase: SupabaseClient, userId: string) {
  const state = await getSyncToken(supabase, userId);
  return {
    connected: Boolean(process.env["GOOGLE_CALENDAR_API_KEY"]),
    gmailConnected: Boolean(process.env["GOOGLE_MAIL_API_KEY"]),
    lastSyncedAt: state?.last_synced_at ?? null,
  };
}
