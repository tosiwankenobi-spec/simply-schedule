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
  /** Outlook-only account binding; never contains a credential or provider token. */
  connectionFingerprint?: string;
  /** Outlook-only integrity proof for the server-generated suggestion. */
  proof?: string;
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

export type ParsedSmartInboxSuggestion = Pick<
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

export function cleanSmartInboxText(value: string, max: number) {
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

export function normalizeSmartInboxExtraction(raw: unknown): ParsedSmartInboxSuggestion | null {
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
  const title = cleanSmartInboxText(parsed.title, 200);
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
      typeof parsed.location === "string"
        ? cleanSmartInboxText(parsed.location, 300) || null
        : null,
    notes:
      typeof parsed.notes === "string" ? cleanSmartInboxText(parsed.notes, 2000) || null : null,
  };
}
