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

function parseGraphDate(value: GraphDateTime, fallbackZone: string): string | null {
  const raw = value?.dateTime;
  if (!raw) return null;
  const zone = value?.timeZone ?? fallbackZone;
  // Graph returns zone-less local timestamps; UTC is the only zone we can trust
  // to be an exact instant, everything else is stored as given plus a Z marker
  // only when the payload already carries an offset.
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw);
  const iso = hasOffset ? raw : `${raw}${zone === "UTC" ? "Z" : "Z"}`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
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
  const starts = parseGraphDate(ev.start, fallbackTimezone);
  if (!removed && !starts) return null;

  const ends = parseGraphDate(ev.end, fallbackTimezone);
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
    timezone: ev.start?.timeZone ?? fallbackTimezone,
    commitment_type: commitment,
    changeKey: ev.changeKey ?? null,
    remote_updated_at: ev.lastModifiedDateTime ?? null,
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
  return Math.round(base * (0.75 + jitter * 0.5));
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
