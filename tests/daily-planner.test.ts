import { describe, expect, test } from "bun:test";
import {
  buildPlannerBusyIntervals,
  computeGaps,
  fitTasks,
  localDayBounds,
  type Prefs,
  type TaskRow,
} from "../src/lib/tasks.server";
import type { TravelPreferences } from "../src/lib/travel-intelligence";

const preferences: TravelPreferences = {
  travel_reminders_enabled: true,
  travel_mode: "driving",
  default_travel_min: 30,
  travel_buffer_min: 10,
  default_prep_min: 15,
};

const plannerProfile: Prefs = {
  id: "profile",
  name: "Workday",
  work_start: "09:00",
  work_end: "12:00",
  default_meeting_min: 30,
  break_every_min: 90,
  break_length_min: 10,
  lunch_at: "12:30",
  lunch_length_min: 0,
  notes: null,
};

describe("daily planner", () => {
  test("builds day bounds from the user's timezone instead of the server timezone", () => {
    expect(localDayBounds("2026-09-04", 360)).toEqual({
      start: "2026-09-04T06:00:00.000Z",
      end: "2026-09-05T06:00:00.000Z",
    });
  });

  test("protects travel, safety buffer and preparation before a physical appointment", () => {
    expect(
      buildPlannerBusyIntervals(
        [
          {
            id: "appointment",
            title: "Dentist",
            starts_at: "2026-09-04T16:00:00.000Z",
            ends_at: "2026-09-04T17:00:00.000Z",
            location: "100 Main Street",
          },
        ],
        preferences,
      ),
    ).toEqual([
      {
        start: Date.parse("2026-09-04T15:05:00.000Z"),
        end: Date.parse("2026-09-04T17:00:00.000Z"),
        travelProtected: true,
      },
    ]);
  });

  test("places a task after the protected travel window", () => {
    const busy = buildPlannerBusyIntervals(
      [
        {
          id: "appointment",
          title: "Dentist",
          starts_at: "2026-09-04T16:00:00.000Z",
          ends_at: "2026-09-04T17:00:00.000Z",
          location: "100 Main Street",
        },
      ],
      preferences,
    );
    const gaps = computeGaps(
      "2026-09-04",
      plannerProfile,
      busy,
      Date.parse("2026-09-04T15:00:00.000Z"),
      360,
    );
    const task: TaskRow = {
      id: "task",
      title: "File return",
      notes: null,
      estimated_min: 60,
      priority: 1,
      energy: "deep",
      deadline: "2026-09-04",
      status: "open",
      scheduled_appointment_id: null,
      created_at: "2026-09-01T00:00:00.000Z",
    };

    expect(fitTasks([task], gaps, plannerProfile).placements[0]).toMatchObject({
      task_id: "task",
      starts_at: "2026-09-04T17:00:00.000Z",
      ends_at: "2026-09-04T18:00:00.000Z",
    });
  });
});
