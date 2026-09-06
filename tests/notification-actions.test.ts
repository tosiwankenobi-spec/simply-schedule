import { describe, expect, test } from "vitest";
import {
  actionsForNotification,
  navigationUrl,
  notificationActionUrl,
} from "../src/lib/notification-actions";
import { buildDue, DEFAULT_PREFS } from "../src/lib/notifications.server";

describe("actionable notifications", () => {
  test("offers completion and rescheduling only for task reminders", () => {
    expect(actionsForNotification({ kind: "overdue", target_type: "task" })).toEqual([
      { id: "done", label: "Done" },
      { id: "snooze", label: "Snooze" },
      { id: "reschedule", label: "Reschedule" },
    ]);
  });

  test("offers navigation for appointments and review for planning nudges", () => {
    expect(actionsForNotification({ kind: "appointment", target_type: "appointment" })[0]?.id).toBe(
      "open_navigation",
    );
    expect(actionsForNotification({ kind: "nudge", target_type: "planner" })[0]?.id).toBe(
      "review_plan",
    );
  });

  test("encodes action and navigation inputs instead of interpolating them", () => {
    expect(notificationActionUrl("abc", "snooze")).toBe(
      "/notification-action?notificationId=abc&action=snooze",
    );
    expect(navigationUrl("1 Main St & 2nd")).toContain("query=1+Main+St+%26+2nd");
  });

  test("binds generated reminders to an owned schedule target", () => {
    const nowMs = Date.parse("2026-09-07T18:00:00.000Z");
    const due = buildDue({
      prefs: { ...DEFAULT_PREFS, appointment_lead_min: [60], nudge_enabled: false },
      nowMs,
      timeZone: "UTC",
      appointments: [
        {
          id: "appointment-id",
          title: "Dentist",
          starts_at: "2026-09-07T19:00:00.000Z",
          location: "1 Main Street",
          notes: null,
          source: "manual",
          commitment_type: "fixed",
          is_all_day: false,
        },
      ],
      tasks: [],
      lastNudgeMs: null,
    });

    expect(due[0]).toMatchObject({
      target_type: "appointment",
      target_id: "appointment-id",
    });
  });
});
