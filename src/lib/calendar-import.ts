import ICAL from "ical.js";

export type CalendarImportKind = "outlook" | "device";

export type CalendarImportEvent = {
  uid: string;
  occurrenceKey: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  notes: string | null;
  timezone: string;
  isAllDay: boolean;
  recurrenceRule: string | null;
};

export type CalendarImportPreview = {
  calendarName: string;
  events: CalendarImportEvent[];
  skipped: number;
  truncated: boolean;
  windowStart: string;
  windowEnd: string;
};

const MAX_EVENTS = 500;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_RECURRENCE_STEPS = 50_000;

function clean(value: string | null | undefined, max: number) {
  const result = value?.replace(/\0/g, "").trim();
  return result ? result.slice(0, max) : null;
}

function calendarName(component: InstanceType<typeof ICAL.Component>, filename: string) {
  const value = component.getFirstPropertyValue("x-wr-calname");
  const fromFile = filename.replace(/\.ics$/i, "").trim();
  return clean(typeof value === "string" ? value : fromFile, 120) ?? "Imported calendar";
}

function recurrenceRule(component: InstanceType<typeof ICAL.Component>) {
  const property = component.getFirstProperty("rrule");
  if (!property) return null;
  return clean(property.toICALString().replace(/^RRULE:/i, ""), 1000);
}

function normalizedEvent(
  event: InstanceType<typeof ICAL.Event>,
  startTime: InstanceType<typeof ICAL.Time>,
  endTime: InstanceType<typeof ICAL.Time>,
  recurrenceKey: string,
): CalendarImportEvent | null {
  const start = startTime.toJSDate();
  const end = endTime.toJSDate();
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;

  const isAllDay = startTime.isDate;
  const fallbackDuration = isAllDay ? 24 * 60 * 60 * 1000 : 30 * 60 * 1000;
  const safeEnd =
    end.getTime() > start.getTime() ? end : new Date(start.getTime() + fallbackDuration);
  const timezone = startTime.zone?.tzid;

  return {
    uid: clean(event.uid, 500) ?? `${start.toISOString()}:${event.summary || "event"}`,
    occurrenceKey: recurrenceKey,
    title: clean(event.summary, 200) ?? "Untitled event",
    startsAt: start.toISOString(),
    endsAt: safeEnd.toISOString(),
    location: clean(event.location, 200),
    notes: clean(event.description, 1000),
    timezone: clean(timezone, 100) ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
    isAllDay,
    recurrenceRule: recurrenceRule(event.component),
  };
}

/** Parses locally so a calendar file is not uploaded before the user reviews its preview. */
export function parseCalendarFile(
  text: string,
  filename: string,
  now = new Date(),
): CalendarImportPreview {
  if (new TextEncoder().encode(text).byteLength > MAX_FILE_BYTES) {
    throw new Error("Calendar files must be 2 MB or smaller.");
  }

  let root: InstanceType<typeof ICAL.Component>;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch {
    throw new Error("That file is not a valid iCalendar (.ics) file.");
  }
  if (root.name !== "vcalendar") throw new Error("That file does not contain an iCalendar.");

  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - 30);
  const windowEnd = new Date(now);
  windowEnd.setFullYear(windowEnd.getFullYear() + 2);

  const output: CalendarImportEvent[] = [];
  let skipped = 0;
  let truncated = false;
  const components = root.getAllSubcomponents("vevent");

  outer: for (const component of components) {
    if (component.hasProperty("recurrence-id")) continue;
    if (String(component.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED") {
      skipped++;
      continue;
    }

    let event: InstanceType<typeof ICAL.Event>;
    try {
      const uid = component.getFirstPropertyValue("uid");
      const exceptions = components.filter(
        (candidate) =>
          candidate.hasProperty("recurrence-id") && candidate.getFirstPropertyValue("uid") === uid,
      );
      event = new ICAL.Event(component, { strictExceptions: true, exceptions });
      if (!event.startDate) throw new Error("Missing start date");
    } catch {
      skipped++;
      continue;
    }

    if (!event.isRecurring()) {
      const start = event.startDate.toJSDate();
      const end = event.endDate.toJSDate();
      if (end < windowStart || start > windowEnd) {
        skipped++;
        continue;
      }
      try {
        const item = normalizedEvent(
          event,
          event.startDate,
          event.endDate,
          event.startDate.toString(),
        );
        if (item) output.push(item);
        else skipped++;
      } catch {
        skipped++;
      }
      if (output.length >= MAX_EVENTS) {
        truncated = true;
        break;
      }
      continue;
    }

    try {
      const iterator = event.iterator();
      let steps = 0;
      for (;;) {
        steps++;
        if (steps > MAX_RECURRENCE_STEPS) {
          skipped++;
          break;
        }
        const occurrence = iterator.next();
        if (!occurrence) break;
        const details = event.getOccurrenceDetails(occurrence);
        const startsAt = details.startDate.toJSDate();
        if (startsAt > windowEnd) break;
        if (details.endDate.toJSDate() < windowStart) continue;
        if (
          String(details.item.component.getFirstPropertyValue("status") ?? "").toUpperCase() ===
          "CANCELLED"
        ) {
          skipped++;
          continue;
        }
        const item = normalizedEvent(
          details.item,
          details.startDate,
          details.endDate,
          details.recurrenceId.toString(),
        );
        if (item) output.push(item);
        else skipped++;
        if (output.length >= MAX_EVENTS) {
          truncated = true;
          break outer;
        }
      }
    } catch {
      skipped++;
    }
  }

  if (output.length === 0) {
    throw new Error("No events were found in the import window.");
  }

  output.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return {
    calendarName: calendarName(root, filename),
    events: output,
    skipped,
    truncated,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
  };
}
