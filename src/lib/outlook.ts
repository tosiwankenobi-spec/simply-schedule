/**
 * Pure, dependency-free helpers for Microsoft Outlook (Graph) synchronization.
 * Safe to import from tests and from client code — contains no secrets and no IO.
 */

export const OUTLOOK_CONNECTOR_ID = "microsoft_outlook";
export const OUTLOOK_PROVIDER = "microsoft_outlook";

export type GraphDateTime = { dateTime?: string; timeZone?: string } | null | undefined;

export type GraphEvent = {
  id?: string;
  iCalUId?: string;
  subject?: string | null;
  bodyPreview?: string | null;
  isAllDay?: boolean;
  isCancelled?: boolean;
  showAs?: string;
  seriesMasterId?: string | null;
  type?: string;
  lastModifiedDateTime?: string;
  changeKey?: string;
  start?: GraphDateTime;
  end?: GraphDateTime;
  location?: { displayName?: string | null } | null;
  "@removed"?: { reason?: string };
};

export type NormalizedOutlookEvent = {
  eventId: string;
  removed: boolean;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  notes: string | null;
  is_all_day: boolean;
  timezone: string;
  commitment_type: "fixed" | "flexible";
  changeKey: string | null;
  remote_updated_at: string | null;
};

/** Stable, provider-scoped identity for one Outlook event. */
export function outlookEventKey(accountId: string, calendarId: string, eventId: string): string {
  return `${OUTLOOK_PROVIDER}:${accountId}:${calendarId}:${eventId}`;
}

/**
 * Microsoft still reports some zones with Windows names. Map the ones Graph
 * commonly returns; anything already IANA-shaped passes through untouched.
 */
const WINDOWS_TO_IANA: Record<string, string> = {
  "UTC": "UTC",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "W. Europe Standard Time": "Europe/Berlin",
  "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw",
  "Romance Standard Time": "Europe/Paris",
  "E. Europe Standard Time": "Europe/Chisinau",
  "FLE Standard Time": "Europe/Kiev",
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Canada Central Standard Time": "America/Regina",
  "Mountain Standard Time": "America/Denver",
  "US Mountain Standard Time": "America/Phoenix",
  "Pacific Standard Time": "America/Los_Angeles",
  "Alaskan Standard Time": "America/Anchorage",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Atlantic Standard Time": "America/Halifax",
  "Newfoundland Standard Time": "America/St_Johns",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "New Zealand Standard Time": "Pacific/Auckland",
  "India Standard Time": "Asia/Kolkata",
  "Tokyo Standard Time": "Asia/Tokyo",
  "China Standard Time": "Asia/Shanghai",
  "Singapore Standard Time": "Asia/Singapore",
  "South Africa Standard Time": "Africa/Johannesburg",
  "E. South America Standard Time": "America/Sao_Paulo",
};

/** Normalize any Graph time-zone label to an IANA zone this runtime understands. */
export function toIanaZone(zone: string | null | undefined): string {
  if (!zone) return "UTC";
  const mapped = WINDOWS_TO_IANA[zone];
  if (mapped) return mapped;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(0);
    return zone;
  } catch {
    return "UTC";
  }
}

function zoneOffsetMs(instantMs: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instantMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUtc - instantMs;
}

/**
 * Convert a zone-less local ("wall clock") timestamp in a named zone into a
 * true UTC instant. Correct across DST transitions because the offset is
 * resolved at the candidate instant, not at the current date.
 */
export function wallTimeToUtcIso(wall: string, zone: string): string | null {
  const clean = wall.replace(/(\.\d+)?Z?$/, "");
  const guess = Date.parse(`${clean}Z`);
  if (!Number.isFinite(guess)) return null;
  const iana = toIanaZone(zone);
  if (iana === "UTC") return new Date(guess).toISOString();
  let instant = guess - zoneOffsetMs(guess, iana);
  instant = guess - zoneOffsetMs(instant, iana);
  return new Date(instant).toISOString();
}

/** Wall-clock parts of a UTC instant inside a named zone, as Graph expects them. */
export function utcToWallTime(iso: string, zone: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const iana = toIanaZone(zone);
  const shifted = new Date(ms + (iana === "UTC" ? 0 : zoneOffsetMs(ms, iana)));
  return shifted.toISOString().replace(/\.\d+Z$/, "");
}

export function parseGraphDate(value: GraphDateTime, fallbackZone: string): string | null {
  const raw = value?.dateTime;
  if (!raw) return null;
  // Values that already carry an offset are exact instants.
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  // Everything else is a wall-clock time in the stated zone — never assume UTC.
  return wallTimeToUtcIso(raw, value?.timeZone ?? fallbackZone);
}

/**
 * Convert one Graph event into an appointment row shape.
 * Returns null when the event cannot be placed on a timeline.
 */
export function normalizeGraphEvent(
  ev: GraphEvent,
  fallbackTimezone = "UTC",
): NormalizedOutlookEvent | null {
  const eventId = ev.id;
  if (!eventId) return null;

  const removed = Boolean(ev["@removed"]) || ev.isCancelled === true;
  const zone = toIanaZone(ev.start?.timeZone ?? fallbackTimezone);
  const starts = parseGraphDate(ev.start, zone);
  if (!removed && !starts) return null;

  const ends = parseGraphDate(ev.end, toIanaZone(ev.end?.timeZone ?? zone));
  const showAs = (ev.showAs ?? "").toLowerCase();
  const commitment: "fixed" | "flexible" =
    showAs === "free" || showAs === "tentative" ? "flexible" : "fixed";

  return {
    eventId,
    removed,
    title: (ev.subject?.trim() || "(untitled Outlook event)").slice(0, 200),
    starts_at: starts ?? new Date(0).toISOString(),
    ends_at: ends,
    location: ev.location?.displayName ? ev.location.displayName.slice(0, 300) : null,
    notes: ev.bodyPreview ? ev.bodyPreview.slice(0, 2000) : null,
    is_all_day: ev.isAllDay === true,
    timezone: zone,
    commitment_type: commitment,
    changeKey: ev.changeKey ?? null,
    remote_updated_at: ev.lastModifiedDateTime ?? null,
  };
}

export type OutlookPushRow = {
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  notes: string | null;
  is_all_day?: boolean | null;
  timezone?: string | null;
};

/**
 * Build the Graph payload for one appointment, preserving all-day flags,
 * midnight boundaries and the event's own time zone instead of forcing UTC.
 */
export function rowToGraphEvent(row: OutlookPushRow): Record<string, unknown> {
  const zone = toIanaZone(row.timezone);
  const startMs = Date.parse(row.starts_at);
  const endMs = row.ends_at ? Date.parse(row.ends_at) : NaN;
  const safeEndMs = Number.isFinite(endMs) ? endMs : startMs + 30 * 60000;

  const base: Record<string, unknown> = {
    subject: row.title,
    body: { contentType: "Text", content: row.notes ?? "" },
    ...(row.location ? { location: { displayName: row.location } } : {}),
  };

  if (row.is_all_day) {
    const startWall = utcToWallTime(new Date(startMs).toISOString(), zone) ?? "";
    const endWall = utcToWallTime(new Date(safeEndMs).toISOString(), zone) ?? "";
    const startDay = startWall.slice(0, 10);
    // Graph requires all-day events to sit on midnight boundaries and to end
    // on the day after the last day they cover.
    let endDay = endWall.slice(0, 10);
    if (!endDay || endDay <= startDay) {
      endDay = new Date(Date.parse(`${startDay}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    } else if (endWall.slice(11) !== "00:00:00") {
      endDay = new Date(Date.parse(`${endDay}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    }
    return {
      ...base,
      isAllDay: true,
      start: { dateTime: `${startDay}T00:00:00`, timeZone: zone },
      end: { dateTime: `${endDay}T00:00:00`, timeZone: zone },
    };
  }

  return {
    ...base,
    isAllDay: false,
    start: { dateTime: utcToWallTime(new Date(startMs).toISOString(), zone), timeZone: zone },
    end: { dateTime: utcToWallTime(new Date(safeEndMs).toISOString(), zone), timeZone: zone },
  };
}


export type DeltaPage = {
  items: GraphEvent[];
  nextLink: string | null;
  deltaLink: string | null;
};

export function readDeltaPage(json: unknown): DeltaPage {
  const body = (json ?? {}) as Record<string, unknown>;
  const value = Array.isArray(body["value"]) ? (body["value"] as GraphEvent[]) : [];
  const nextLink = typeof body["@odata.nextLink"] === "string" ? body["@odata.nextLink"] : null;
  const deltaLink = typeof body["@odata.deltaLink"] === "string" ? body["@odata.deltaLink"] : null;
  return { items: value, nextLink, deltaLink };
}

/** Graph signals stale/expired delta state with 410 Gone or a resync error code. */
export function isDeltaResyncRequired(status: number, body: string): boolean {
  if (status === 410) return true;
  if (status !== 400) return false;
  return /resyncRequired|SyncStateNotFound|invalid.*delta|deltatoken/i.test(body);
}

export function isAuthFailure(status: number): boolean {
  return status === 401 || status === 403;
}

export function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/** Bounded exponential backoff with jitter, capped at 8 seconds. */
export function backoffDelayMs(attempt: number, jitter = 0.5): number {
  const base = Math.min(8000, 500 * 2 ** Math.max(0, attempt - 1));
  return Math.min(8000, Math.round(base * (0.75 + jitter * 0.5)));
}

export function appointmentRowsAreEqual(
  a: { title: string; starts_at: string; ends_at: string | null; location: string | null },
  b: { title: string; starts_at: string; ends_at: string | null; location: string | null },
): boolean {
  return (
    a.title === b.title &&
    a.starts_at === b.starts_at &&
    a.ends_at === b.ends_at &&
    (a.location ?? null) === (b.location ?? null)
  );
}
