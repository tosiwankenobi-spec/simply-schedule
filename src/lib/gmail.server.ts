/**
 * Gmail two-way sync engine (server-only).
 *
 * Mirrors calendar.server.ts: retry with exponential backoff, structured
 * result objects, sync_state for incremental cursors, and sync_log events.
 *
 * Pull  — incremental via Gmail history.list (falls back to a keyword scan
 *         when the stored historyId is stale, same idea as a 410 sync token).
 * Push  — replies on the originating thread, never auto-sent: the UI drafts
 *         the text and the user confirms before sendGmailReply runs.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { logEvent, getSettings } from "./calendar.server";

const GMAIL_BASE = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";
export const GMAIL_PROVIDER = "google_mail";

const KEYWORD_QUERY =
  "in:inbox newer_than:14d (meeting OR appointment OR reservation OR invite OR scheduled OR confirmed OR flight OR booking)";

type Json = Record<string, unknown>;
type Keys = { lovableKey: string; gmailKey: string };

export type GmailSyncResult = {
  scanned: number;
  imported: number;
  skipped: number;
  /** True when the stored historyId was unusable and we re-scanned instead. */
  fullRescan: boolean;
  historyId: string | null;
  retries: number;
  errors: string[];
};

export type GmailSyncStatus = {
  connected: boolean;
  enabled: boolean;
  lastSyncedAt: string | null;
  minutesSinceSync: number | null;
  hasHistoryId: boolean;
  messagesSeen: number;
  runs: number;
  lastError: string | null;
  needsReauth: boolean;
};

function keys(): Keys {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const gmailKey = process.env["GOOGLE_MAIL_API_KEY"];
  if (!lovableKey) throw new Error("Missing LOVABLE_API_KEY");
  if (!gmailKey) throw new Error("Gmail is not connected yet.");
  return { lovableKey, gmailKey };
}

/* ------------------------------------------------------------------ */
/* HTTP with retry + exponential backoff                               */
/* ------------------------------------------------------------------ */

const MAX_ATTEMPTS = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRetryableStatus(status: number) {
  return status === 429 || status >= 500;
}

export class GmailApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "GmailApiError";
    this.status = status;
  }
}

async function gmailFetch(
  path: string,
  k: Keys,
  init?: { method?: string; body?: Json },
  onRetry?: (attempt: number, reason: string) => void,
): Promise<{ status: number; json: any }> {
  let lastReason = "unknown error";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${GMAIL_BASE}${path}`, {
        method: init?.method ?? "GET",
        headers: {
          Authorization: `Bearer ${k.lovableKey}`,
          "X-Connection-Api-Key": k.gmailKey,
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
        },
        ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
      });

      if (res.ok) {
        const text = await res.text();
        return { status: res.status, json: text ? JSON.parse(text) : {} };
      }

      const body = await res.text().catch(() => "");
      if (!isRetryableStatus(res.status)) {
        throw new GmailApiError(res.status, `Gmail API ${res.status}: ${body.slice(0, 300)}`);
      }
      lastReason = `HTTP ${res.status}`;
    } catch (e) {
      if (e instanceof GmailApiError) throw e;
      lastReason = e instanceof Error ? e.message : "network error";
    }

    if (attempt < MAX_ATTEMPTS) {
      onRetry?.(attempt, lastReason);
      await sleep(400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200));
    }
  }

  throw new GmailApiError(0, `Gmail request failed after ${MAX_ATTEMPTS} attempts: ${lastReason}`);
}

/* ------------------------------------------------------------------ */
/* Message parsing                                                     */
/* ------------------------------------------------------------------ */

type GmailHeader = { name: string; value: string };
type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[] };
type GmailMessage = {
  id: string;
  threadId?: string;
  snippet?: string;
  payload?: { headers?: GmailHeader[] } & GmailPart;
};

function decodeBase64Url(data: string): string {
  try {
    const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

function encodeBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function extractPlainText(part: GmailPart | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return decodeBase64Url(part.body.data);
  if (part.parts) {
    for (const p of part.parts) {
      const t = extractPlainText(p);
      if (t) return t;
    }
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    return decodeBase64Url(part.body.data).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return "";
}

function header(msg: GmailMessage, name: string): string {
  return (
    msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ""
  );
}

/* ------------------------------------------------------------------ */
/* AI extraction                                                       */
/* ------------------------------------------------------------------ */

type ParsedAppointment = {
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  notes: string | null;
};

async function aiExtract(
  text: string,
  lovableKey: string,
  nowIso: string,
  tzOffsetMin: number,
): Promise<ParsedAppointment | null> {
  const localNow = new Date(Date.now() - tzOffsetMin * 60000).toISOString().replace("Z", "");
  const system = `You extract a single appointment from an email if and only if one is clearly present.

CURRENT CONTEXT
- Now (UTC): ${nowIso}
- Now (user local): ${localNow}
- Resolve relative phrases against user-local time.

DECIDE FIRST: Does this email describe a SPECIFIC scheduled appointment, meeting, reservation, flight, or event with a date AND time? Newsletters, marketing, receipts without an event, generic announcements → return {"appointment": false}.

If yes, return:
{"appointment": true, "title": string (action-first, <=60 chars, strip Re:/Fwd:/Invitation:), "starts_at": ISO 8601 with timezone offset (assume user's offset ${-tzOffsetMin} min if missing), "ends_at": ISO or null, "location": physical address/room/venue/video link or null, "notes": one short sentence or null}

Return ONLY JSON, no markdown.`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: system },
        { role: "user", content: text.slice(0, 8000) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    }),
  });
  if (res.status === 429) throw new Error("AI rate limit reached.");
  if (res.status === 402) throw new Error("AI credits exhausted.");
  if (!res.ok) throw new Error(`AI request failed (${res.status})`);

  const json = await res.json();
  let content: string = json?.choices?.[0]?.message?.content ?? "";
  content = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    const parsed = JSON.parse(content);
    if (!parsed?.appointment || !parsed.title || !parsed.starts_at) return null;
    if (Number.isNaN(Date.parse(parsed.starts_at))) return null;
    if (parsed.ends_at && Number.isNaN(Date.parse(parsed.ends_at))) parsed.ends_at = null;
    return {
      title: String(parsed.title).slice(0, 200),
      starts_at: parsed.starts_at as string,
      ends_at: (parsed.ends_at ?? null) as string | null,
      location: parsed.location ? String(parsed.location).slice(0, 200) : null,
      notes: parsed.notes ? String(parsed.notes).slice(0, 1000) : null,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Sync state                                                          */
/* ------------------------------------------------------------------ */

type GmailState = {
  historyId: string | null;
  lastSyncedAt: string | null;
  pagesSynced: number;
  eventsSeen: number;
  lastError: string | null;
};

async function readState(supabase: SupabaseClient, userId: string): Promise<GmailState> {
  const { data } = await supabase
    .from("sync_state")
    .select("sync_token, last_synced_at, pages_synced, events_seen, last_error")
    .eq("user_id", userId)
    .eq("provider", GMAIL_PROVIDER)
    .maybeSingle();
  return {
    historyId: data?.sync_token ?? null,
    lastSyncedAt: data?.last_synced_at ?? null,
    pagesSynced: data?.pages_synced ?? 0,
    eventsSeen: data?.events_seen ?? 0,
    lastError: data?.last_error ?? null,
  };
}

async function writeState(
  supabase: SupabaseClient,
  userId: string,
  patch: {
    historyId?: string | null;
    lastSyncedAt?: string | null;
    pagesSynced?: number;
    eventsSeen?: number;
    lastError?: string | null;
  },
) {
  await supabase.from("sync_state").upsert(
    {
      user_id: userId,
      provider: GMAIL_PROVIDER,
      calendar_id: null,
      ...(patch.historyId !== undefined ? { sync_token: patch.historyId } : {}),
      ...(patch.lastSyncedAt !== undefined ? { last_synced_at: patch.lastSyncedAt } : {}),
      ...(patch.pagesSynced !== undefined ? { pages_synced: patch.pagesSynced } : {}),
      ...(patch.eventsSeen !== undefined ? { events_seen: patch.eventsSeen } : {}),
      ...(patch.lastError !== undefined ? { last_error: patch.lastError } : {}),
    },
    { onConflict: "user_id,provider" },
  );
}

/* ------------------------------------------------------------------ */
/* Candidate discovery                                                 */
/* ------------------------------------------------------------------ */

const MAX_HISTORY_PAGES = 5;
const MAX_CANDIDATES = 25;

async function candidatesFromHistory(
  k: Keys,
  startHistoryId: string,
  onRetry: (a: number, r: string) => void,
): Promise<{ ids: string[]; pages: number; historyId: string | null } | "stale"> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  let latest: string | null = null;

  for (let i = 0; i < MAX_HISTORY_PAGES; i++) {
    let res;
    try {
      res = await gmailFetch(
        `/users/me/history?startHistoryId=${encodeURIComponent(startHistoryId)}` +
          `&historyTypes=messageAdded&maxResults=100` +
          (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""),
        k,
        undefined,
        onRetry,
      );
    } catch (e) {
      // 404 = the history ID is older than Gmail keeps; 410 for parity with Calendar.
      if (e instanceof GmailApiError && (e.status === 404 || e.status === 410)) return "stale";
      throw e;
    }

    pages++;
    latest = res.json?.historyId ?? latest;
    for (const h of res.json?.history ?? []) {
      for (const added of h.messagesAdded ?? []) {
        const id = added?.message?.id;
        const labels: string[] = added?.message?.labelIds ?? [];
        if (!id) continue;
        if (labels.includes("DRAFT") || labels.includes("SENT") || labels.includes("TRASH")) continue;
        if (!ids.includes(id)) ids.push(id);
      }
    }

    pageToken = res.json?.nextPageToken;
    if (!pageToken || ids.length >= MAX_CANDIDATES) break;
  }

  return { ids: ids.slice(0, MAX_CANDIDATES), pages, historyId: latest };
}

async function candidatesFromScan(
  k: Keys,
  onRetry: (a: number, r: string) => void,
): Promise<{ ids: string[]; pages: number }> {
  const res = await gmailFetch(
    `/users/me/messages?maxResults=${MAX_CANDIDATES}&q=${encodeURIComponent(KEYWORD_QUERY)}`,
    k,
    undefined,
    onRetry,
  );
  return { ids: (res.json?.messages ?? []).map((m: { id: string }) => m.id), pages: 1 };
}

/* ------------------------------------------------------------------ */
/* Pull                                                                */
/* ------------------------------------------------------------------ */

export async function runGmailSync(
  supabase: SupabaseClient,
  userId: string,
  opts?: { tzOffsetMin?: number },
): Promise<GmailSyncResult> {
  const result: GmailSyncResult = {
    scanned: 0,
    imported: 0,
    skipped: 0,
    fullRescan: false,
    historyId: null,
    retries: 0,
    errors: [],
  };

  const k = keys();
  const onRetry = (attempt: number, reason: string) => {
    result.retries++;
    void logEvent(supabase, userId, "warn", "gmail_retry", `Retry ${attempt}: ${reason}`);
  };

  const state = await readState(supabase, userId);

  // Gmail's current watermark — stored after a successful pass so the next run
  // only looks at what arrived in between.
  let newHistoryId: string | null = null;
  try {
    const profile = await gmailFetch("/users/me/profile", k, undefined, onRetry);
    newHistoryId = profile.json?.historyId ? String(profile.json.historyId) : null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Couldn't read the Gmail profile";
    result.errors.push(msg);
    await writeState(supabase, userId, { lastError: msg });
    await logEvent(supabase, userId, "error", "gmail_import", msg);
    return result;
  }

  let ids: string[] = [];
  let pages = 0;

  try {
    if (state.historyId) {
      const inc = await candidatesFromHistory(k, state.historyId, onRetry);
      if (inc === "stale") {
        result.fullRescan = true;
        await logEvent(
          supabase,
          userId,
          "warn",
          "gmail_import",
          "Gmail history ID expired — falling back to a full keyword re-scan.",
        );
        const scan = await candidatesFromScan(k, onRetry);
        ids = scan.ids;
        pages = scan.pages;
      } else {
        ids = inc.ids;
        pages = inc.pages;
        newHistoryId = inc.historyId ?? newHistoryId;
      }
    } else {
      result.fullRescan = true;
      const scan = await candidatesFromScan(k, onRetry);
      ids = scan.ids;
      pages = scan.pages;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Gmail listing failed";
    result.errors.push(msg);
    await writeState(supabase, userId, { lastError: msg });
    await logEvent(supabase, userId, "error", "gmail_import", msg);
    return result;
  }

  result.scanned = ids.length;
  const nowIso = new Date().toISOString();
  const tzOffsetMin = opts?.tzOffsetMin ?? 0;

  for (const id of ids) {
    const externalId = `gmail:${id}`;

    // Dedupe: a message we already turned into an appointment is never
    // re-extracted and never re-notified.
    const { data: existing } = await supabase
      .from("appointments")
      .select("id")
      .eq("user_id", userId)
      .eq("external_id", externalId)
      .maybeSingle();
    if (existing) {
      result.skipped++;
      continue;
    }

    let full: GmailMessage;
    try {
      const res = await gmailFetch(`/users/me/messages/${id}?format=full`, k, undefined, onRetry);
      full = res.json as GmailMessage;
    } catch {
      result.skipped++;
      continue;
    }

    const subject = header(full, "subject");
    const from = header(full, "from");
    const date = header(full, "date");
    const body = extractPlainText(full.payload) || full.snippet || "";
    const text = `Subject: ${subject}\nFrom: ${from}\nDate: ${date}\n\n${body}`.slice(0, 8000);

    let parsed: ParsedAppointment | null = null;
    try {
      parsed = await aiExtract(text, k.lovableKey, nowIso, tzOffsetMin);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "AI extraction failed";
      if (!result.errors.includes(msg)) result.errors.push(msg);
      result.skipped++;
      continue;
    }
    if (!parsed) {
      result.skipped++;
      continue;
    }

    const { error } = await supabase.from("appointments").insert({
      user_id: userId,
      title: parsed.title,
      starts_at: parsed.starts_at,
      ends_at: parsed.ends_at,
      location: parsed.location,
      notes: parsed.notes,
      source: "gmail",
      external_id: externalId,
      gmail_message_id: id,
      gmail_thread_id: full.threadId ?? null,
      gmail_from: from.slice(0, 320) || null,
      gmail_subject: subject.slice(0, 300) || null,
    });
    if (error) {
      result.skipped++;
      continue;
    }
    result.imported++;
    await logEvent(supabase, userId, "info", "gmail_import", `Imported “${parsed.title}” from email.`, {
      detail: { messageId: id, threadId: full.threadId ?? null },
    });
  }

  result.historyId = newHistoryId;
  await writeState(supabase, userId, {
    historyId: newHistoryId,
    lastSyncedAt: new Date().toISOString(),
    pagesSynced: state.pagesSynced + pages,
    eventsSeen: state.eventsSeen + result.scanned,
    lastError: result.errors[0] ?? null,
  });

  await logEvent(
    supabase,
    userId,
    result.errors.length > 0 ? "warn" : "info",
    "gmail_import",
    `${result.fullRescan ? "Full re-scan" : "Incremental sync"}: ${result.scanned} scanned · ` +
      `${result.imported} imported · ${result.skipped} skipped.`,
  );

  return result;
}

export async function readGmailStatus(
  supabase: SupabaseClient,
  userId: string,
): Promise<GmailSyncStatus> {
  const [state, settings] = await Promise.all([
    readState(supabase, userId),
    getSettings(supabase, userId),
  ]);
  const AUTH_HINT = /\b(401|403)\b|denied|invalid_grant|unauthori[sz]ed|insufficient/i;
  return {
    connected: Boolean(process.env["GOOGLE_MAIL_API_KEY"]),
    enabled: settings.gmail_sync_enabled,
    lastSyncedAt: state.lastSyncedAt,
    minutesSinceSync: state.lastSyncedAt
      ? Math.max(0, Math.round((Date.now() - Date.parse(state.lastSyncedAt)) / 60000))
      : null,
    hasHistoryId: Boolean(state.historyId),
    messagesSeen: state.eventsSeen,
    runs: state.pagesSynced,
    lastError: state.lastError,
    needsReauth:
      !process.env["GOOGLE_MAIL_API_KEY"] ||
      (state.lastError ? AUTH_HINT.test(state.lastError) : false),
  };
}

export async function resetGmailHistory(supabase: SupabaseClient, userId: string) {
  await writeState(supabase, userId, { historyId: null, lastError: null });
  await logEvent(
    supabase,
    userId,
    "info",
    "gmail_import",
    "Gmail history cursor cleared — next sync does a full re-scan.",
  );
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Push-back: replies on the originating thread                        */
/* ------------------------------------------------------------------ */

export type ReplyKind = "confirm" | "decline" | "reschedule";

type GmailAppointment = {
  id: string;
  title: string;
  starts_at: string;
  source: string | null;
  gmail_thread_id: string | null;
  gmail_message_id: string | null;
  gmail_from: string | null;
  gmail_subject: string | null;
  gmail_reply_state: string | null;
  gmail_replied_at: string | null;
};

export async function loadGmailAppointment(
  supabase: SupabaseClient,
  userId: string,
  appointmentId: string,
): Promise<GmailAppointment> {
  const { data, error } = await supabase
    .from("appointments")
    .select(
      "id,title,starts_at,source,gmail_thread_id,gmail_message_id,gmail_from,gmail_subject,gmail_reply_state,gmail_replied_at",
    )
    .eq("user_id", userId)
    .eq("id", appointmentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Appointment not found.");
  const appt = data as GmailAppointment;
  if (appt.source !== "gmail" || !appt.gmail_thread_id) {
    throw new Error("This appointment didn't come from an email, so there's no thread to reply to.");
  }
  return appt;
}

/** Suggested reply text. The user always sees and can edit this before sending. */
export function replyTemplate(kind: ReplyKind, appt: { title: string; starts_at: string }) {
  const when = new Date(appt.starts_at).toUTCString().replace(" GMT", "");
  switch (kind) {
    case "confirm":
      return `Confirmed — see you then.\n\n(${appt.title}, ${when})`;
    case "decline":
      return `Sorry, I can't make it. Apologies for the short notice.\n\n(${appt.title}, ${when})`;
    case "reschedule":
    default:
      return `Sorry, I can't make it at that time — could we reschedule?\n\n(${appt.title}, ${when})`;
  }
}

export async function buildGmailReplyDraft(
  supabase: SupabaseClient,
  userId: string,
  appointmentId: string,
  kind: ReplyKind,
) {
  const appt = await loadGmailAppointment(supabase, userId, appointmentId);
  const subject = appt.gmail_subject ?? appt.title;
  return {
    to: appt.gmail_from ?? "",
    subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
    body: replyTemplate(kind, appt),
    alreadyReplied: appt.gmail_reply_state,
    repliedAt: appt.gmail_replied_at,
  };
}

/**
 * Sends the reply the user just confirmed. Never called without an explicit
 * click — there is no automatic send path anywhere in the engine.
 */
export async function sendGmailReply(
  supabase: SupabaseClient,
  userId: string,
  input: { appointmentId: string; kind: ReplyKind; body: string },
): Promise<{ ok: true; threadId: string }> {
  const k = keys();
  const appt = await loadGmailAppointment(supabase, userId, input.appointmentId);

  const original = await gmailFetch(
    `/users/me/messages/${appt.gmail_message_id}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Subject&metadataHeaders=From`,
    k,
  );
  const meta = original.json as GmailMessage;
  const messageId = header(meta, "message-id");
  const references = header(meta, "references");
  const subjectRaw = appt.gmail_subject ?? header(meta, "subject") ?? appt.title;
  const subject = /^re:/i.test(subjectRaw) ? subjectRaw : `Re: ${subjectRaw}`;
  const to = appt.gmail_from ?? header(meta, "from");
  if (!to) throw new Error("Couldn't work out who to reply to.");

  const encodeHeader = (v: string) =>
    /^[\x00-\x7F]*$/.test(v) ? v : `=?UTF-8?B?${encodeBase64Url(v).replace(/-/g, "+").replace(/_/g, "/")}?=`;

  const mime = [
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    ...(messageId ? [`In-Reply-To: ${messageId}`, `References: ${references ? `${references} ${messageId}` : messageId}`] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    input.body,
  ].join("\r\n");

  try {
    await gmailFetch("/users/me/messages/send", k, {
      method: "POST",
      body: { raw: encodeBase64Url(mime), threadId: appt.gmail_thread_id },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Reply failed";
    await logEvent(supabase, userId, "error", "gmail_reply", `Reply not sent: ${msg}`, {
      detail: { appointmentId: appt.id },
    });
    throw new Error(msg);
  }

  await supabase
    .from("appointments")
    .update({ gmail_reply_state: input.kind, gmail_replied_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("id", appt.id);

  await logEvent(
    supabase,
    userId,
    "info",
    "gmail_reply",
    `Sent a ${input.kind} reply on “${subject}”.`,
    { detail: { appointmentId: appt.id, threadId: appt.gmail_thread_id } },
  );

  return { ok: true, threadId: appt.gmail_thread_id! };
}

/**
 * Local edits/deletions of an email-sourced appointment are never pushed back
 * to Gmail — rewriting someone else's email makes no sense — but they are
 * recorded so the activity feed stays honest.
 */
export async function logGmailLocalChange(
  supabase: SupabaseClient,
  userId: string,
  input: { title: string; change: "updated" | "deleted" },
) {
  await logEvent(
    supabase,
    userId,
    "info",
    "gmail_local_change",
    `“${input.title}” was ${input.change} in Chronos-V. The original email was left untouched.`,
  );
  return { ok: true };
}
