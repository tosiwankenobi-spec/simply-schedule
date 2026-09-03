import { describe, expect, test } from "bun:test";
import { normalizeSmartInboxExtraction } from "../src/lib/gmail-inbox.server";

describe("Smart Inbox extraction", () => {
  test("keeps timed school events on the schedule", () => {
    expect(
      normalizeSmartInboxExtraction({
        suggestion: true,
        kind: "school_event",
        destination: "schedule",
        title: "Parent-teacher conference",
        starts_at: "2026-09-10T18:00:00-06:00",
        ends_at: "2026-09-10T18:30:00-06:00",
        deadline: null,
        estimated_min: 30,
        location: "Room 12",
        notes: "Meet with the homeroom teacher.",
      }),
    ).toEqual({
      kind: "school_event",
      destination: "schedule",
      title: "Parent-teacher conference",
      starts_at: "2026-09-11T00:00:00.000Z",
      ends_at: "2026-09-11T00:30:00.000Z",
      deadline: null,
      estimated_min: 30,
      location: "Room 12",
      notes: "Meet with the homeroom teacher.",
    });
  });

  test("turns date-only deliveries into reviewable tasks", () => {
    expect(
      normalizeSmartInboxExtraction({
        suggestion: true,
        kind: "delivery",
        destination: "tasks",
        title: "Receive appliance delivery",
        starts_at: null,
        ends_at: null,
        deadline: "2026-09-14",
        estimated_min: 1,
        location: null,
        notes: "Delivery date confirmed.",
      }),
    ).toMatchObject({
      kind: "delivery",
      destination: "tasks",
      starts_at: null,
      deadline: "2026-09-14",
      estimated_min: 5,
    });
  });

  test("rejects task suggestions without a valid deadline", () => {
    expect(
      normalizeSmartInboxExtraction({
        suggestion: true,
        kind: "renewal",
        destination: "tasks",
        title: "Renew registration",
        deadline: "sometime soon",
      }),
    ).toBeNull();
  });

  test("rejects unsafe kind and destination combinations", () => {
    expect(
      normalizeSmartInboxExtraction({
        suggestion: true,
        kind: "deadline",
        destination: "schedule",
        title: "Submit application",
        starts_at: "2026-09-15T09:00:00Z",
      }),
    ).toBeNull();
  });

  test("rejects suggestions whose title becomes empty after sanitizing", () => {
    expect(
      normalizeSmartInboxExtraction({
        suggestion: true,
        kind: "delivery",
        destination: "tasks",
        title: "\u0000\u0007",
        deadline: "2026-09-15",
      }),
    ).toBeNull();
  });
});
