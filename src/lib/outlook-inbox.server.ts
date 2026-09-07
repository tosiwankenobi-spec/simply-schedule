/** Read-only Microsoft Graph mail scanning for Smart Inbox. Server only. */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { callAsAppUser } from "@/integrations/lovable/appUserConnector";
import { getConnectionKeyForUser } from "@/server/appUserConnections.server";
import { OUTLOOK_CONNECTOR_ID } from "./outlook";
import { extractSmartInboxSuggestion } from "./smart-inbox-ai.server";
import {
  cleanSmartInboxText,
  type SmartInboxAcceptResult,
  type SmartInboxCandidate,
  type SmartInboxScanResult,
} from "./smart-inbox";

export type {
  SmartInboxAcceptResult,
  SmartInboxCandidate,
  SmartInboxScanResult,
} from "./smart-inbox";

const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";
const PROVIDER = "microsoft_outlook_mail";
const SOURCE = "outlook_mail";
const MAX_MESSAGES = 15;
const DISMISSAL_DAYS = 30;
const KEYWORDS =
  /\b(meeting|appointment|reservation|invite|scheduled|confirmed|flight|booking|delivery|arriving|school|renewal|renew|deadline|due)\b/i;

type UserClient = SupabaseClient<Database>;
type GraphMessage = {
  id?: string;
  conversationId?: string | null;
  subject?: string | null;
  receivedDateTime?: string | null;
  bodyPreview?: string | null;
  from?: { emailAddress?: { name?: string | null; address?: string | null } | null } | null;
  body?: { contentType?: string | null; content?: string | null } | null;
};
type ExistingAppointment = {
  id: string;
  starts_at: string;
  ends_at: string | null;
  is_all_day: boolean;
};
type ScheduledCandidate = SmartInboxCandidate & { starts_at: string };

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function accountFingerprint(connectionKey: string) {
  return hash(`chronos-outlook-mail-account:${connectionKey}`);
}

function messageKey(fingerprint: string, messageId: string) {
  return hash(`chronos-outlook-mail-message:${fingerprint}:${messageId}`);
}

function externalId(fingerprint: string, messageId: string) {
  return `outlook-mail:${messageKey(fingerprint, messageId)}`;
}

function proofPayload(candidate: SmartInboxCandidate) {
  return JSON.stringify({
    messageId: candidate.messageId,
    threadId: candidate.threadId,
    from: candidate.from,
    subject: candidate.subject,
    kind: candidate.kind,
    destination: candidate.destination,
    title: candidate.title,
    starts_at: candidate.starts_at,
    ends_at: candidate.ends_at,
    deadline: candidate.deadline,
    estimated_min: candidate.estimated_min,
    location: candidate.location,
    notes: candidate.notes,
    connectionFingerprint: candidate.connectionFingerprint,
  });
}

function signCandidate(candidate: SmartInboxCandidate, secret: string) {
  return createHmac("sha256", secret).update(proofPayload(candidate)).digest("hex");
}

function validProof(candidate: SmartInboxCandidate, secret: string) {
  if (!candidate.proof || !/^[0-9a-f]{64}$/.test(candidate.proof)) return false;
  const expected = signCandidate(candidate, secret);
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(candidate.proof, "hex"));
}

function keys() {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  if (!lovableKey) throw new Error("Smart Inbox AI is not connected yet.");
  return { lovableKey };
}

async function connectionFor(userId: string) {
  const connectionKey = await getConnectionKeyForUser(userId, OUTLOOK_CONNECTOR_ID);
  if (!connectionKey) throw new Error("Connect Outlook before scanning its inbox.");
  return { connectionKey, fingerprint: accountFingerprint(connectionKey) };
}

async function assertEnabled(supabase: UserClient, userId: string) {
  const { data, error } = await supabase
    .from("sync_settings")
    .select("outlook_mail_sync_enabled")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (
    (data as { outlook_mail_sync_enabled?: boolean } | null)?.outlook_mail_sync_enabled === false
  ) {
    throw new Error("Outlook email access is paused in Privacy controls.");
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function graphFetch<T>(connectionKey: string, path: string, prefer?: string): Promise<T> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const response = await callAsAppUser({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectionAPIKey: connectionKey,
      connectorId: OUTLOOK_CONNECTOR_ID,
      path,
      init: { headers: prefer ? { Prefer: prefer } : undefined },
    });
    if (response.ok) return (await response.json()) as T;
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "Outlook email access needs permission. Reconnect Outlook to grant Mail.Read.",
      );
    }
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 4) {
      throw new Error(`Outlook inbox scan failed (${response.status}).`);
    }
    await sleep(400 * 2 ** (attempt - 1));
  }
  throw new Error("Outlook inbox scan failed.");
}

function sender(message: GraphMessage) {
  const email = message.from?.emailAddress;
  const name = cleanSmartInboxText(email?.name ?? "", 160);
  const address = cleanSmartInboxText(email?.address ?? "", 160);
  return name && address ? `${name} <${address}>` : name || address;
}

function plainText(message: GraphMessage) {
  const content = message.body?.content ?? message.bodyPreview ?? "";
  if (message.body?.contentType?.toLowerCase() !== "html") return content;
  return content.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
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

async function findOverlaps(
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
  const { data, error } = await supabase
    .from("appointments")
    .select("id,starts_at,ends_at,is_all_day")
    .eq("user_id", userId)
    .lt("starts_at", new Date(maxEnd).toISOString())
    .or(
      `ends_at.gt.${new Date(minStart).toISOString()},and(ends_at.is.null,starts_at.gt.${new Date(minStart - 1800000).toISOString()})`,
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
  const { error } = await supabase.from("sync_log").insert({
    user_id: userId,
    level: "info",
    kind,
    message: message.slice(0, 500),
    detail: detail ?? null,
  });
  if (error) throw new Error(error.message);
}

function loggedKeys(
  rows: Array<{ detail: Database["public"]["Tables"]["sync_log"]["Row"]["detail"] }>,
) {
  const keys = new Set<string>();
  for (const row of rows) {
    if (!row.detail || typeof row.detail !== "object" || Array.isArray(row.detail)) continue;
    const key = (row.detail as Record<string, unknown>).messageKey;
    if (typeof key === "string" && /^[0-9a-f]{64}$/.test(key)) keys.add(key);
  }
  return keys;
}

async function extractCandidate(
  message: GraphMessage,
  connectionKey: string,
  fingerprint: string,
  lovableKey: string,
  nowIso: string,
  tzOffsetMin: number,
): Promise<SmartInboxCandidate | null> {
  if (!message.id) return null;
  const full = await graphFetch<GraphMessage>(
    connectionKey,
    `/me/messages/${encodeURIComponent(message.id)}?$select=id,conversationId,subject,from,receivedDateTime,body`,
    'outlook.body-content-type="text"',
  );
  const subject = cleanSmartInboxText(full.subject ?? "", 300);
  const from = sender(full);
  const parsed = await extractSmartInboxSuggestion(
    `Subject: ${subject}\nFrom: ${from}\nDate: ${cleanSmartInboxText(full.receivedDateTime ?? "", 100)}\n\n${plainText(full)}`,
    lovableKey,
    nowIso,
    tzOffsetMin,
  );
  if (!parsed) return null;
  const candidate: SmartInboxCandidate = {
    messageId: message.id,
    threadId: full.conversationId ?? null,
    from,
    subject,
    ...parsed,
    conflicts: 0,
    connectionFingerprint: fingerprint,
  };
  candidate.proof = signCandidate(candidate, lovableKey);
  return candidate;
}

export async function scanOutlookInbox(
  supabase: UserClient,
  userId: string,
  tzOffsetMin: number,
): Promise<SmartInboxScanResult> {
  await assertEnabled(supabase, userId);
  const [{ lovableKey }, { connectionKey, fingerprint }] = await Promise.all([
    Promise.resolve(keys()),
    connectionFor(userId),
  ]);
  const list = await graphFetch<{ value?: GraphMessage[] }>(
    connectionKey,
    "/me/mailFolders/inbox/messages?$top=50&$select=id,conversationId,subject,from,receivedDateTime,bodyPreview&$orderby=receivedDateTime%20desc",
  );
  const cutoff = Date.now() - 30 * 86400000;
  const messages = (list.value ?? [])
    .filter((message): message is GraphMessage & { id: string } => {
      const received = Date.parse(message.receivedDateTime ?? "");
      return (
        Boolean(message.id) &&
        received >= cutoff &&
        KEYWORDS.test(`${message.subject ?? ""} ${message.bodyPreview ?? ""}`)
      );
    })
    .slice(0, MAX_MESSAGES);
  const identities = messages.map((message) => ({
    message,
    key: messageKey(fingerprint, message.id),
    externalId: externalId(fingerprint, message.id),
  }));
  const dismissalCutoff = new Date(Date.now() - DISMISSAL_DAYS * 86400000).toISOString();
  const [existingResult, dismissedResult, acceptedTaskResult] = await Promise.all([
    identities.length
      ? supabase
          .from("appointments")
          .select("external_id")
          .eq("user_id", userId)
          .in(
            "external_id",
            identities.map((item) => item.externalId),
          )
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("sync_log")
      .select("detail")
      .eq("user_id", userId)
      .eq("kind", "outlook_mail_dismissed")
      .gte("created_at", dismissalCutoff)
      .limit(1000),
    supabase
      .from("sync_log")
      .select("detail")
      .eq("user_id", userId)
      .eq("kind", "outlook_mail_accepted_task")
      .limit(1000),
  ]);
  if (existingResult.error || dismissedResult.error || acceptedTaskResult.error) {
    throw new Error(
      (existingResult.error ?? dismissedResult.error ?? acceptedTaskResult.error)?.message,
    );
  }
  const existing = new Set((existingResult.data ?? []).map((row) => row.external_id));
  const dismissed = loggedKeys(dismissedResult.data ?? []);
  const acceptedTasks = loggedKeys(acceptedTaskResult.data ?? []);
  const pending = identities.filter(
    (item) =>
      !existing.has(item.externalId) && !dismissed.has(item.key) && !acceptedTasks.has(item.key),
  );
  const candidates: SmartInboxCandidate[] = [];
  let skipped = 0;
  let completed = 0;
  let firstError: Error | null = null;
  const nowIso = new Date().toISOString();
  for (let index = 0; index < pending.length; index += 3) {
    const results = await Promise.allSettled(
      pending
        .slice(index, index + 3)
        .map(({ message }) =>
          extractCandidate(message, connectionKey, fingerprint, lovableKey, nowIso, tzOffsetMin),
        ),
    );
    for (const result of results) {
      if (result.status === "fulfilled") {
        completed++;
        if (result.value) candidates.push(result.value);
        else skipped++;
      } else {
        skipped++;
        if (!firstError)
          firstError =
            result.reason instanceof Error ? result.reason : new Error("Email extraction failed.");
      }
    }
  }
  if (pending.length > 0 && completed === 0 && firstError) throw firstError;
  const scheduled = candidates.filter((candidate): candidate is ScheduledCandidate =>
    Boolean(candidate.starts_at),
  );
  const appointments = await findOverlaps(supabase, userId, scheduled);
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
  const { error: stateError } = await supabase.from("sync_state").upsert(
    {
      user_id: userId,
      provider: PROVIDER,
      calendar_id: null,
      last_synced_at: nowIso,
      last_attempt_at: nowIso,
      last_success_at: nowIso,
      incomplete: false,
      pages_synced: 1,
      events_seen: messages.length,
      last_error: null,
    },
    { onConflict: "user_id,provider" },
  );
  if (stateError) throw new Error(stateError.message);
  await logEvent(supabase, userId, "outlook_mail_scan", "Outlook Smart Inbox scan completed.", {
    scanned: messages.length,
    candidates: withConflicts.length,
    skipped,
  });
  return {
    scanned: messages.length,
    candidates: withConflicts,
    alreadyHandled: identities.filter(
      (item) => existing.has(item.externalId) || acceptedTasks.has(item.key),
    ).length,
    dismissed: identities.filter((item) => dismissed.has(item.key)).length,
    skipped,
  };
}

async function verifiedContext(
  supabase: UserClient,
  userId: string,
  candidate: SmartInboxCandidate,
) {
  await assertEnabled(supabase, userId);
  const { lovableKey } = keys();
  const { fingerprint } = await connectionFor(userId);
  if (candidate.connectionFingerprint !== fingerprint) {
    throw new Error("Your Outlook account changed. Scan again before adding this suggestion.");
  }
  if (!validProof(candidate, lovableKey)) {
    throw new Error("That suggestion could not be verified. Scan Outlook again.");
  }
  return { fingerprint };
}

export async function acceptOutlookCandidate(
  supabase: UserClient,
  userId: string,
  candidate: SmartInboxCandidate,
): Promise<SmartInboxAcceptResult> {
  const { fingerprint } = await verifiedContext(supabase, userId, candidate);
  const key = messageKey(fingerprint, candidate.messageId);
  if (candidate.destination === "tasks") {
    if (!candidate.deadline) throw new Error("That suggestion no longer has a valid deadline.");
    const { data: handled, error: handledError } = await supabase
      .from("sync_log")
      .select("detail")
      .eq("user_id", userId)
      .eq("kind", "outlook_mail_accepted_task")
      .contains("detail", { messageKey: key })
      .limit(1)
      .maybeSingle();
    if (handledError) throw new Error(handledError.message);
    const detail = handled?.detail;
    const taskId =
      detail && typeof detail === "object" && !Array.isArray(detail)
        ? (detail as Record<string, unknown>).taskId
        : null;
    if (typeof taskId === "string") {
      const { data: task, error } = await supabase
        .from("tasks")
        .select("id")
        .eq("user_id", userId)
        .eq("id", taskId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (task) return { itemId: task.id, itemType: "task", alreadyAdded: true, conflicts: 0 };
    }
    const { data: task, error } = await supabase
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
    if (error) throw new Error(error.message);
    await logEvent(
      supabase,
      userId,
      "outlook_mail_accepted_task",
      "Added an Outlook Smart Inbox task.",
      { messageKey: key, taskId: task.id, suggestionKind: candidate.kind },
    );
    return { itemId: task.id, itemType: "task", alreadyAdded: false, conflicts: 0 };
  }
  if (!candidate.starts_at) throw new Error("That suggestion no longer has a valid time.");
  const id = externalId(fingerprint, candidate.messageId);
  const scheduled = candidate as ScheduledCandidate;
  const [{ data: existing, error: existingError }, appointments] = await Promise.all([
    supabase
      .from("appointments")
      .select("id")
      .eq("user_id", userId)
      .eq("external_id", id)
      .maybeSingle(),
    findOverlaps(supabase, userId, [scheduled]),
  ]);
  if (existingError) throw new Error(existingError.message);
  const conflicts = countConflicts(scheduled, appointments);
  if (existing)
    return { itemId: existing.id, itemType: "appointment", alreadyAdded: true, conflicts };
  const { data: appointment, error } = await supabase
    .from("appointments")
    .insert({
      user_id: userId,
      title: candidate.title,
      starts_at: candidate.starts_at,
      ends_at: candidate.ends_at,
      location: candidate.location,
      notes: candidate.notes,
      source: SOURCE,
      provider: "microsoft_outlook",
      provider_account_id: `mail:${fingerprint.slice(0, 16)}`,
      calendar_event_id: null,
      external_id: id,
      commitment_type: "fixed",
      privacy_level: "private",
      source_metadata: {
        smart_inbox_kind: candidate.kind,
        outlook_message_key: key,
        outlook_conversation_key: candidate.threadId
          ? hash(`${fingerprint}:${candidate.threadId}`)
          : null,
        sender: candidate.from || null,
        subject: candidate.subject || null,
      },
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      const { data: raced } = await supabase
        .from("appointments")
        .select("id")
        .eq("user_id", userId)
        .eq("external_id", id)
        .single();
      if (raced)
        return { itemId: raced.id, itemType: "appointment", alreadyAdded: true, conflicts };
    }
    throw new Error(error.message);
  }
  await logEvent(
    supabase,
    userId,
    "outlook_mail_accepted",
    "Added an Outlook Smart Inbox suggestion.",
    { messageKey: key, appointmentId: appointment.id, conflicts },
  );
  return { itemId: appointment.id, itemType: "appointment", alreadyAdded: false, conflicts };
}

export async function dismissOutlookCandidate(
  supabase: UserClient,
  userId: string,
  messageId: string,
  fingerprint: string,
) {
  await assertEnabled(supabase, userId);
  const current = await connectionFor(userId);
  if (current.fingerprint !== fingerprint)
    throw new Error("Your Outlook account changed. Scan again.");
  await logEvent(
    supabase,
    userId,
    "outlook_mail_dismissed",
    "Dismissed an Outlook Smart Inbox suggestion.",
    { messageKey: messageKey(fingerprint, messageId) },
  );
  return { dismissed: true as const };
}
