import { describe, expect, test } from "vitest";
import type { CalendarEvent, DeviceCalendar } from "@capacitor/calendar";
import {
  DEVICE_CALENDAR_MAX_EVENTS_PER_CALENDAR,
  buildDeviceCalendarPreview,
} from "../src/lib/device-calendar";

const NOW = new Date("2026-09-06T12:00:00Z");
const calendars: DeviceCalendar[] = [
  { id: "personal-id", name: "Personal", isPrimary: true },
  { id: "work-id", name: "Work" },
];

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "event-1",
    title: "Planning session",
    calendarId: "personal-id",
    startDate: new Date("2026-09-07T15:00:00Z").getTime(),
    endDate: new Date("2026-09-07T16:00:00Z").getTime(),
    ...overrides,
  };
}

describe("native device calendar preview", () => {
  test("includes only explicitly selected calendars and sanitizes local data", () => {
    const preview = buildDeviceCalendarPreview(
      calendars,
      [
        event({ title: "  Planning\0 session  ", notes: "  Private notes  " }),
        event({ id: "work-event", calendarId: "work-id", title: "Work meeting" }),
      ],
      ["personal-id"],
      NOW,
    );

    expect(preview.eventCount).toBe(1);
    expect(preview.calendars).toHaveLength(1);
    expect(preview.calendars[0]?.calendarName).toBe("Personal");
    expect(preview.calendars[0]?.events[0]?.title).toBe("Planning session");
    expect(preview.calendars[0]?.events[0]?.notes).toBe("Private notes");
  });

  test("keeps recurring occurrences distinct and deduplicates exact repeats", () => {
    const first = event();
    const second = event({
      startDate: new Date("2026-09-14T15:00:00Z").getTime(),
      endDate: new Date("2026-09-14T16:00:00Z").getTime(),
    });
    const preview = buildDeviceCalendarPreview(
      calendars,
      [first, first, second],
      ["personal-id"],
      NOW,
    );

    expect(preview.eventCount).toBe(2);
    expect(preview.calendars[0]?.events.map((item) => item.occurrenceKey)).toEqual([
      "2026-09-07T15:00:00.000Z",
      "2026-09-14T15:00:00.000Z",
    ]);
  });

  test("uses an unambiguous calendar name when a platform omits the event calendar id", () => {
    const preview = buildDeviceCalendarPreview(
      calendars,
      [event({ calendarId: undefined, calendarName: "Personal" })],
      ["personal-id"],
      NOW,
    );

    expect(preview.eventCount).toBe(1);
    expect(preview.calendars[0]?.events[0]?.title).toBe("Planning session");
  });

  test("rejects out-of-window events and repairs an invalid end time", () => {
    const preview = buildDeviceCalendarPreview(
      calendars,
      [
        event({
          id: "old",
          startDate: new Date("2026-01-01T10:00:00Z").getTime(),
          endDate: new Date("2026-01-01T11:00:00Z").getTime(),
        }),
        event({ endDate: new Date("2026-09-07T14:00:00Z").getTime() }),
      ],
      ["personal-id"],
      NOW,
    );

    expect(preview.skipped).toBe(1);
    expect(preview.eventCount).toBe(1);
    expect(preview.calendars[0]?.events[0]?.endsAt).toBe("2026-09-07T15:30:00.000Z");
  });

  test("caps each calendar without hiding that its preview is incomplete", () => {
    const events = Array.from({ length: DEVICE_CALENDAR_MAX_EVENTS_PER_CALENDAR + 1 }, (_, index) =>
      event({
        id: `event-${index}`,
        startDate: new Date("2026-09-07T15:00:00Z").getTime() + index * 60_000,
        endDate: new Date("2026-09-07T15:30:00Z").getTime() + index * 60_000,
      }),
    );
    const preview = buildDeviceCalendarPreview(calendars, events, ["personal-id"], NOW);

    expect(preview.eventCount).toBe(DEVICE_CALENDAR_MAX_EVENTS_PER_CALENDAR);
    expect(preview.calendars[0]?.truncated).toBe(true);
  });
});
