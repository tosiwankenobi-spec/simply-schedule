import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const GMAIL_BASE = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";
const GMAIL_PROVIDER = "google_mail";
const GMAIL_QUERY =
  "in:inbox newer_than:30d (meeting OR appointment OR reservation OR invite OR scheduled OR confirmed OR flight OR booking OR delivery OR arriving OR school OR renewal OR renew OR deadline OR due)";
const GMAIL_ID = /^[A-Za-z0-9_-]{1,200}$/;
const MAX_MESSAGES = 15;
const DISMISSAL_DAYS = 30;

type UserClient = SupabaseClient<Database>;
type GmailHeader = { name: string; value: string };
type GmailMessagePart = {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailMessagePart[];
};
type GmailMessage = {
  id: string;
  threadId?: string;
  snippet?: string;
  payload?: { headers?: GmailHeader[] } & GmailMessagePart;
};
type ParsedAppointment = Pick<
  SmartInboxCandidate,
  | "kind"
  | "destination"
  | "title"
  | "starts_at"
  | "ends_at"
  | "deadline"
  | "estimated_min"
  | "location"
  | "notes"
>;
type ExistingAppointment = {
  id: string;
  starts_at: string;
  ends_at: string | null;
  is_all_day: boolean;
};
type ScheduledCandidate = SmartInboxCandidate & { starts_at: string };

export type SmartInboxCandidate = {
  messageId: string;
  threadId: string | null;
  from: string;
  subject: string;
  kind: "appointment" | "reservation" | "school_event" | "delivery" | "renewal" | "deadline";
  destination: "schedule" | "tasks";
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  deadline: string | null;
  estimated_min: number;
  location: string | null;
  notes: string | null;
  conflicts: number;
};

export type SmartInboxScanResult = {
  scanned: number;
  candidates: SmartInboxCandidate[];
  alreadyHandled: number;
  dismissed: number;
  skipped: number;
};

export type SmartInboxAcceptResult = {
  itemId: string;
  itemType: "appointment" | "task";
  alreadyAdded: boolean;
  conflicts: number;
};

const SMART_INBOX_KINDS = new Set<SmartInboxCandidate["kind"]>([
  "appointment",
  "reservation",
  "school_event",
  "delivery",
  "renewal",
  "deadline",
]);

function validDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function normalizeSmartInboxExtraction(raw: unknown): ParsedAppointment | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const parsed = raw as Record<string, unknown>;
  if (parsed.suggestion !== true || typeof parsed.kind !== "string") return null;
  const kind = parsed.kind as SmartInboxCandidate["kind"];
  if (!SMART_INBOX_KINDS.has(kind) || typeof parsed.title !== "string") return null;
  const destination = parsed.destination;
  if (destination !== "schedule" && destination !== "tasks") return null;
  if (
    ((kind === "renewal" || kind === "deadline") && destination !== "tasks") ||
    ((kind === "appointment" || kind === "reservation" || kind === "school_event") &&
      destination !== "schedule")
  ) {
    return null;
  }

  const rawStart = typeof parsed.starts_at === "string" ? Date.parse(parsed.starts_at) : Number.NaN;
  const startsAt = Number.isFinite(rawStart) ? new Date(rawStart).toISOString() : null;
  const deadline = validDateKey(parsed.deadline) ? parsed.deadline : null;
  if ((destination === "schedule" && !startsAt) || (destination === "tasks" && !deadline)) {
    return null;
  }

  const rawEnd = typeof parsed.ends_at === "string" ? Date.parse(parsed.ends_at) : Number.NaN;
  const end =
    startsAt && Number.isFinite(rawEnd) && rawEnd > rawStart && rawEnd - rawStart <= 7 * 86400000
      ? new Date(rawEnd).toISOString()
      : null;
  const requestedMinutes =
    typeof parsed.estimated_min === "number" ? Math.round(parsed.estimated_min) : 15;
  const title = cleanSummary(parsed.title, 200);
  if (!title) return null;

  return {
    kind,
    destination,
    title,
    starts_at: destination === "schedule" ? startsAt : null,
    ends_at: destination === "schedule" ? end : null,
    deadline: destination === "tasks" ? deadline : null,
    estimated_min: Math.min(480, Math.max(5, requestedMinutes)),
    location:
      typeof parsed.location === "string" ? cleanSummary(parsed.location, 300) || null : null,
    notes: typeof parsed.notes === "string" ? cleanSummary(parsed.notes, 2000) || null : null,
  };
}

function keys() {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const gmailKey = process.env["GOOGLE_MAIL_API_KEY"];
  if (!lovableKey) throw new Error("Smart Inbox AI is not connected yet.");
  if (!gmailKey) throw new Error("Gmail is not connected yet.");
  return { lovableKey, gmailKey };
}

async function assertGmailEnabled(supabase: UserClient, userId: string) {
  const { data, error } = await supabase
    .from("sync_settings")
    .select("gmail_sync_enabled")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.gmail_sync_enabled === false) {
    throw new Error("Gmail access is paused in Privacy controls.");
  }
}

async function gatewayFetch<T>(path: string, lovableKey: string, gmailKey: string): Promise<T> {
  const response = await fetch(`${GMAIL_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": gmailKey,
    },
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Gmail access needs to be reconnected.");
    }
    if (response.status === 429) throw new Error("Gmail is busy. Try the scan again shortly.");
    throw new Error(`Gmail scan failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

function decodeBase64Url(data: string): string {
  try {
    const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const buffer = (
      globalThis as {
        Buffer?: {
          from: (value: string, encoding: string) => { toString: (encoding: string) => string };
        };
      }
    ).Buffer;
    if (buffer) return buffer.from(padded, "base64").toString("utf-8");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

function extractPlainText(part: GmailMessagePart | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  for (const child of part.parts ?? []) {
    const text = extractPlainText(child);
    if (text) return text;
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    return decodeBase64Url(part.body.data)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

function header(message: GmailMessage, name: string) {
  return (
    message.payload?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())
      ?.value ?? ""
  );
}

function cleanSummary(value: string, max: number) {
  return Array.from(value)
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

async function aiExtract(
  text: string,
  lovableKey: string,
  nowIso: string,
  tzOffsetMin: number,
): Promise<ParsedAppointment | null> {
  const localNow = new Date(Date.now() - tzOffsetMin * 60000).toISOString().replace("Z", "");
  const system = `You extract one useful schedule or task suggestion from an email only when the obligation is explicit.

CURRENT CONTEXT
- Now (UTC): ${nowIso}
- Now (user local): ${localNow}
- Resolve relative phrases against user-local time.

SUPPORTED KINDS
- appointment, reservation, or school_event: use destination "schedule" and require a specific date AND time.
- delivery: use "schedule" when a delivery window has times; otherwise use "tasks" with the promised date as its deadline.
- renewal or deadline: use destination "tasks" and require a specific due date.

Newsletters, marketing, receipts without a future obligation, vague announcements, and messages without the required date return {"suggestion":false}.

If useful, return {"suggestion":true,"kind":"appointment|reservation|school_event|delivery|renewal|deadline","destination":"schedule|tasks","title":string,"starts_at":ISO 8601 with timezone offset or null,"ends_at":ISO or null,"deadline":"YYYY-MM-DD" or null,"estimated_min":5-480,"location":string or null,"notes":one short sentence or null}.
Assume the user's offset is ${-tzOffsetMin} minutes when the email omits one. Keep the title under 60 characters and remove reply/forward prefixes. Return ONLY JSON.`;

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
  if (response.status === 429) throw new Error("Smart Inbox AI is busy. Try again shortly.");
  if (response.status === 402) throw new Error("Smart Inbox AI credits are exhausted.");
  if (!response.ok) throw new Error(`Smart Inbox AI failed (${response.status}).`);

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = (json.choices?.[0]?.message?.content ?? "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  try {
    return normalizeSmartInboxExtraction(JSON.parse(content));
  } catch {
    return null;
  }
}

function interval(startsAt: string, endsAt: string | null, defaultMinutes: number) {
  const start = Date.parse(startsAt);
  const parsedEnd = endsAt ? Date.parse(endsAt) : Number.NaN;
  const end =
    Number.isFinite(parsedEnd) && parsedEnd > start ? parsedEnd : start + defaultMinutes * 60000;
  return { start, end };
}

function countConflicts(candidate: ScheduledCandidate, appointments: ExistingAppointment[]) {
  const proposed = interval(candidate.starts_at, candidate.ends_at, 60);
  return appointments.filter((appointment) => {
    if (appointment.is_all_day) return false;
    const existing = interval(appointment.starts_at, appointment.ends_at, 30);
    return proposed.start < existing.end && proposed.end > existing.start;
  }).length;
}

async function findOverlappingAppointments(
  supabase: UserClient,
  userId: string,
  candidates: ScheduledCandidate[],
) {
  if (candidates.length === 0) return [];
  const ranges = candidates.map((candidate) =>
    interval(candidate.starts_at, candidate.ends_at, 60),
  );
  const minStart = Math.min(...ranges.map((range) => range.start));
  const maxEnd = Math.max(...ranges.map((range) => range.end));
  const nullEndFloor = new Date(minStart - 30 * 60000).toISOString();
  const { data, error } = await supabase
    .from("appointments")
    .select("id,starts_at,ends_at,is_all_day")
    .eq("user_id", userId)
    .lt("starts_at", new Date(maxEnd).toISOString())
    .or(
      `ends_at.gt.${new Date(minStart).toISOString()},and(ends_at.is.null,starts_at.gt.${nullEndFloor})`,
    );
  if (error) throw new Error(error.message);
  return (data ?? []) as ExistingAppointment[];
}

async function logEvent(
  supabase: UserClient,
  userId: string,
  kind: string,
  message: string,
  detail?: Record<string, string | number | null>,
) {
  await supabase.from("sync_log").insert({
    user_id: userId,
    level: "info",
    kind,
    message: message.slice(0, 500),
    detail: detail ?? null,
  });
}

function loggedMessageIds(
  rows: Array<{ detail: Database["public"]["Tables"]["sync_log"]["Row"]["detail"] }>,
) {
  const ids = new Set<string>();
  for (const row of rows) {
    const detail = row.detail;
    if (detail && typeof detail === "object" && !Array.isArray(detail)) {
      const messageId = (detail as Record<string, unknown>).messageId;
      if (typeof messageId === "string" && GMAIL_ID.test(messageId)) ids.add(messageId);
    }
  }
  return ids;
}

async function extractCandidate(
  id: string,
  lovableKey: string,
  gmailKey: string,
  nowIso: string,
  tzOffsetMin: number,
): Promise<SmartInboxCandidate | null> {
  const full = await gatewayFetch<GmailMessage>(
    `/users/me/messages/${encodeURIComponent(id)}?format=full`,
    lovableKey,
    gmailKey,
  );
  const subject = cleanSummary(header(full, "subject"), 300);
  const from = cleanSummary(header(full, "from"), 320);
  const date = cleanSummary(header(full, "date"), 200);
  const body = extractPlainText(full.payload) || full.snippet || "";
  const parsed = await aiExtract(
    `Subject: ${subject}\nFrom: ${from}\nDate: ${date}\n\n${body}`,
    lovableKey,
    nowIso,
    tzOffsetMin,
  );
  if (!parsed || !parsed.title) return null;
  return {
    messageId: id,
    threadId: full.threadId && GMAIL_ID.test(full.threadId) ? full.threadId : null,
    from,
    subject,
    ...parsed,
    conflicts: 0,
  };
}

export async function scanSmartInbox(
  supabase: UserClient,
  userId: string,
  tzOffsetMin: number,
): Promise<SmartInboxScanResult> {
  await assertGmailEnabled(supabase, userId);
  const { lovableKey, gmailKey } = keys();
  const list = await gatewayFetch<{ messages?: Array<{ id?: string }> }>(
    `/users/me/messages?maxResults=${MAX_MESSAGES}&q=${encodeURIComponent(GMAIL_QUERY)}`,
    lovableKey,
    gmailKey,
  );
  const ids = Array.from(
    new Set(
      (list.messages ?? []).map((message) => message.id ?? "").filter((id) => GMAIL_ID.test(id)),
    ),
  ).slice(0, MAX_MESSAGES);
  if (ids.length === 0) {
    await recordScan(supabase, userId, 0, 0, 0);
    return { scanned: 0, candidates: [], alreadyHandled: 0, dismissed: 0, skipped: 0 };
  }

  const externalIds = ids.map((id) => `gmail:${id}`);
  const dismissalCutoff = new Date(Date.now() - DISMISSAL_DAYS * 86400000).toISOString();
  const [existingResult, dismissalResult, acceptedTaskResult] = await Promise.all([
    supabase
      .from("appointments")
      .select("external_id")
      .eq("user_id", userId)
      .in("external_id", externalIds),
    supabase
      .from("sync_log")
      .select("detail")
      .eq("user_id", userId)
      .eq("kind", "gmail_dismissed")
      .gte("created_at", dismissalCutoff)
      .limit(1000),
    supabase
      .from("sync_log")
      .select("detail")
      .eq("user_id", userId)
      .eq("kind", "gmail_accepted_task")
      .gte("created_at", dismissalCutoff)
      .limit(1000),
  ]);
  if (existingResult.error) throw new Error(existingResult.error.message);
  if (dismissalResult.error) throw new Error(dismissalResult.error.message);
  if (acceptedTaskResult.error) throw new Error(acceptedTaskResult.error.message);

  const existing = new Set(
    (existingResult.data ?? [])
      .map((row) => row.external_id?.replace(/^gmail:/, ""))
      .filter((id): id is string => Boolean(id)),
  );
  const dismissed = loggedMessageIds(dismissalResult.data ?? []);
  const acceptedTasks = loggedMessageIds(acceptedTaskResult.data ?? []);
  const pendingIds = ids.filter(
    (id) => !existing.has(id) && !acceptedTasks.has(id) && !dismissed.has(id),
  );
  const candidates: SmartInboxCandidate[] = [];
  let skipped = 0;
  let completedExtractions = 0;
  let firstExtractionError: Error | null = null;
  const nowIso = new Date().toISOString();

  for (let index = 0; index < pendingIds.length; index += 3) {
    const batch = pendingIds.slice(index, index + 3);
    const results = await Promise.allSettled(
      batch.map((id) => extractCandidate(id, lovableKey, gmailKey, nowIso, tzOffsetMin)),
    );
    for (const result of results) {
      if (result.status === "fulfilled") {
        completedExtractions++;
        if (result.value) candidates.push(result.value);
        else skipped++;
      } else {
        skipped++;
        if (!firstExtractionError) {
          firstExtractionError =
            result.reason instanceof Error ? result.reason : new Error("Email extraction failed.");
        }
      }
    }
  }

  if (pendingIds.length > 0 && completedExtractions === 0 && firstExtractionError) {
    throw firstExtractionError;
  }

  const scheduled = candidates.filter((candidate): candidate is ScheduledCandidate =>
    Boolean(candidate.starts_at),
  );
  const appointments = await findOverlappingAppointments(supabase, userId, scheduled);
  const withConflicts = candidates
    .map((candidate) => ({
      ...candidate,
      conflicts: candidate.starts_at
        ? countConflicts(candidate as ScheduledCandidate, appointments)
        : 0,
    }))
    .sort((left, right) =>
      (left.starts_at ?? left.deadline ?? "").localeCompare(
        right.starts_at ?? right.deadline ?? "",
      ),
    );
  await recordScan(supabase, userId, ids.length, withConflicts.length, skipped);

  return {
    scanned: ids.length,
    candidates: withConflicts,
    alreadyHandled: ids.filter((id) => existing.has(id) || acceptedTasks.has(id)).length,
    dismissed: ids.filter((id) => dismissed.has(id)).length,
    skipped,
  };
}

async function recordScan(
  supabase: UserClient,
  userId: string,
  scanned: number,
  candidates: number,
  skipped: number,
) {
  const { data: current } = await supabase
    .from("sync_state")
    .select("pages_synced,events_seen")
    .eq("user_id", userId)
    .eq("provider", GMAIL_PROVIDER)
    .maybeSingle();
  const { error } = await supabase.from("sync_state").upsert(
    {
      user_id: userId,
      provider: GMAIL_PROVIDER,
      calendar_id: null,
      last_synced_at: new Date().toISOString(),
      pages_synced: (current?.pages_synced ?? 0) + 1,
      events_seen: (current?.events_seen ?? 0) + scanned,
      last_error: null,
    },
    { onConflict: "user_id,provider" },
  );
  if (error) throw new Error(error.message);
  await logEvent(supabase, userId, "gmail_scan", "Smart Inbox scan completed.", {
    scanned,
    candidates,
    skipped,
  });
}

export async function acceptSmartInboxCandidate(
  supabase: UserClient,
  userId: string,
  candidate: SmartInboxCandidate,
): Promise<SmartInboxAcceptResult> {
  await assertGmailEnabled(supabase, userId);

  if (candidate.destination === "tasks") {
    if (!candidate.deadline) throw new Error("That suggestion no longer has a valid deadline.");
    const { data: handled, error: handledError } = await supabase
      .from("sync_log")
      .select("detail")
      .eq("user_id", userId)
      .eq("kind", "gmail_accepted_task")
      .contains("detail", { messageId: candidate.messageId })
      .limit(1)
      .maybeSingle();
    if (handledError) throw new Error(handledError.message);
    const handledDetail = handled?.detail;
    const handledTaskId =
      handledDetail && typeof handledDetail === "object" && !Array.isArray(handledDetail)
        ? (handledDetail as Record<string, unknown>).taskId
        : null;
    if (typeof handledTaskId === "string") {
      const { data: task, error: taskError } = await supabase
        .from("tasks")
        .select("id")
        .eq("user_id", userId)
        .eq("id", handledTaskId)
        .maybeSingle();
      if (taskError) throw new Error(taskError.message);
      if (task) {
        return { itemId: task.id, itemType: "task", alreadyAdded: true, conflicts: 0 };
      }
    }

    const { data: insertedTask, error: taskInsertError } = await supabase
      .from("tasks")
      .insert({
        user_id: userId,
        title: candidate.title,
        notes: candidate.notes,
        deadline: candidate.deadline,
        estimated_min: candidate.estimated_min,
        priority: candidate.kind === "deadline" ? 1 : 2,
        energy: "light",
        status: "todo",
      })
      .select("id")
      .single();
    if (taskInsertError) throw new Error(taskInsertError.message);
    await logEvent(supabase, userId, "gmail_accepted_task", "Added a Smart Inbox task.", {
      messageId: candidate.messageId,
      taskId: insertedTask.id,
      suggestionKind: candidate.kind,
    });
    return { itemId: insertedTask.id, itemType: "task", alreadyAdded: false, conflicts: 0 };
  }

  if (!candidate.starts_at) throw new Error("That suggestion no longer has a valid time.");
  const scheduledCandidate = candidate as ScheduledCandidate;
  const externalId = `gmail:${candidate.messageId}`;
  const { data: existing, error: existingError } = await supabase
    .from("appointments")
    .select("id")
    .eq("user_id", userId)
    .eq("external_id", externalId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  const appointments = await findOverlappingAppointments(supabase, userId, [scheduledCandidate]);
  const conflicts = countConflicts(scheduledCandidate, appointments);
  if (existing) {
    return { itemId: existing.id, itemType: "appointment", alreadyAdded: true, conflicts };
  }

  const { data: inserted, error } = await supabase
    .from("appointments")
    .insert({
      user_id: userId,
      title: candidate.title,
      starts_at: candidate.starts_at,
      ends_at: candidate.ends_at,
      location: candidate.location,
      notes: candidate.notes,
      source: "gmail",
      external_id: externalId,
      gmail_message_id: candidate.messageId,
      gmail_thread_id: candidate.threadId,
      gmail_from: candidate.from || null,
      gmail_subject: candidate.subject || null,
      commitment_type: "fixed",
      source_metadata: { smart_inbox_kind: candidate.kind },
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      const { data: raced } = await supabase
        .from("appointments")
        .select("id")
        .eq("user_id", userId)
        .eq("external_id", externalId)
        .single();
      if (raced) {
        return { itemId: raced.id, itemType: "appointment", alreadyAdded: true, conflicts };
      }
    }
    throw new Error(error.message);
  }
  await logEvent(supabase, userId, "gmail_accepted", "Added a Smart Inbox suggestion.", {
    messageId: candidate.messageId,
    appointmentId: inserted.id,
    conflicts,
  });
  return { itemId: inserted.id, itemType: "appointment", alreadyAdded: false, conflicts };
}

export async function dismissSmartInboxCandidate(
  supabase: UserClient,
  userId: string,
  messageId: string,
): Promise<{ dismissed: true }> {
  await assertGmailEnabled(supabase, userId);
  const { error } = await supabase.from("sync_log").insert({
    user_id: userId,
    level: "info",
    kind: "gmail_dismissed",
    message: "Dismissed a Smart Inbox suggestion.",
    detail: { messageId },
  });
  if (error) throw new Error(error.message);
  return { dismissed: true };
}
