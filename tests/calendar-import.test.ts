import { describe, expect, test } from "bun:test";
import { parseCalendarFile } from "../src/lib/calendar-import";

const NOW = new Date("2026-09-03T12:00:00Z");

describe("calendar file import", () => {
  test("parses timed and all-day events", () => {
    const preview = parseCalendarFile(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "X-WR-CALNAME:Family devices",
        "BEGIN:VEVENT",
        "UID:meeting-1",
        "DTSTART:20260904T150000Z",
        "DTEND:20260904T160000Z",
        "SUMMARY:School meeting",
        "LOCATION:Room 2",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:birthday-1",
        "DTSTART;VALUE=DATE:20260908",
        "DTEND;VALUE=DATE:20260909",
        "SUMMARY:Avery's birthday",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
      "calendar.ics",
      NOW,
    );

    expect(preview.calendarName).toBe("Family devices");
    expect(preview.events).toHaveLength(2);
    expect(preview.events[0]?.title).toBe("School meeting");
    expect(preview.events[0]?.startsAt).toBe("2026-09-04T15:00:00.000Z");
    expect(preview.events[1]?.isAllDay).toBe(true);
  });

  test("expands recurring events and honors cancellations", () => {
    const preview = parseCalendarFile(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:weekly-1",
        "DTSTART:20260904T150000Z",
        "DTEND:20260904T153000Z",
        "RRULE:FREQ=WEEKLY;COUNT=3",
        "SUMMARY:Weekly check-in",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:weekly-1",
        "RECURRENCE-ID:20260911T150000Z",
        "DTSTART:20260911T150000Z",
        "DTEND:20260911T153000Z",
        "STATUS:CANCELLED",
        "SUMMARY:Weekly check-in",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
      "work.ics",
      NOW,
    );

    expect(preview.events.map((event) => event.startsAt)).toEqual([
      "2026-09-04T15:00:00.000Z",
      "2026-09-18T15:00:00.000Z",
    ]);
    expect(preview.skipped).toBe(1);
  });

  test("rejects malformed files", () => {
    expect(() => parseCalendarFile("not a calendar", "bad.ics", NOW)).toThrow(
      "not a valid iCalendar",
    );
  });
});
