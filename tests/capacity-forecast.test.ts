import { describe, expect, test } from "vitest";
import {
  buildCapacityForecast,
  forecastDates,
  formatMinutes,
  linkedBlockIds,
  mapForecastTasks,
  localDateString,
  localDayRange,
  normalizeTimeZone,
  overlapsRange,
  rankForecastTasks,
  resolveProfileIdForDate,
  zoneOffsetMinutes,
  zonedInstant,
  type ForecastDayInput,
  type ForecastTask,
} from "../src/lib/capacity-forecast";
import {
  buildPlannerBusyIntervals,
  computeGaps,
  localDayBounds,
  type Prefs,
} from "../src/lib/tasks.server";
import type { TravelPreferences } from "../src/lib/travel-intelligence";

const NOW = Date.parse("2026-09-07T13:00:00.000Z");

const prefs: Prefs = {
  id: "profile",
  name: "Workday",
  work_start: "09:00",
  work_end: "17:00",
  default_meeting_min: 30,
  break_every_min: 90,
  break_length_min: 10,
  lunch_at: "12:30",
  lunch_length_min: 45,
  notes: null,
};

const travel: TravelPreferences = {
  travel_reminders_enabled: true,
  travel_mode: "driving",
  default_travel_min: 30,
  travel_buffer_min: 10,
  default_prep_min: 15,
};

/** A plain day with one contiguous free window of `minutes`, starting 09:00 UTC. */
function day(date: string, minutes: number, gaps?: number[]): ForecastDayInput {
  const base = Date.parse(`${date}T09:00:00.000Z`);
  const windows = gaps ?? [minutes];
  let cursor = base;
  const built = windows.map((len) => {
    const start = cursor;
    cursor = start + (len + 30) * 60000;
    return { start, end: start + len * 60000 };
  });
  return {
    date,
    offsetMinutes: 0,
    gaps: built,
    breakMinutes: 0,
    workingMinutes: 480,
    committedMinutes: 480 - windows.reduce((s, m) => s + m, 0),
    profileName: "Workday",
  };
}

function task(overrides: Partial<ForecastTask> & { id: string }): ForecastTask {
  return {
    title: `Task ${overrides.id}`,
    estimatedMin: 60,
    priority: 2,
    deadline: null,
    status: "open",
    createdAt: "2026-09-01T00:00:00.000Z",
    scheduledStart: null,
    scheduledEnd: null,
    ...overrides,
  };
}

const days3 = [day("2026-09-07", 120), day("2026-09-08", 120), day("2026-09-09", 120)];

function forecast(tasks: ForecastTask[], days = days3) {
  return buildCapacityForecast({ nowMs: NOW, timeZone: "UTC", days, tasks });
}

describe("capacity forecast — empty and simple states", () => {
  test("no tasks and an empty calendar reads as nothing due", () => {
    const result = forecast([]);
    expect(result.deadlines).toEqual([]);
    expect(result.backlog).toEqual([]);
    expect(result.counts).toEqual({ critical: 0, tight: 0, onTrack: 0, backlog: 0 });
    expect(result.totalCapacityMinutes).toBe(360);
    expect(result.headline).toContain("Nothing is due");
    expect(result.firstOverloadedDate).toBeNull();
  });

  test("a comfortable deadline is on track with slack reported", () => {
    const result = forecast([task({ id: "a", estimatedMin: 60, deadline: "2026-09-09" })]);
    expect(result.deadlines[0]).toMatchObject({
      taskId: "a",
      status: "on-track",
      shortfallMinutes: 0,
      plannedDate: "2026-09-07",
    });
    expect(result.deadlines[0]!.slackMinutes).toBe(300);
  });

  test("tasks without deadlines stay visible as backlog without urgency", () => {
    const result = forecast([task({ id: "b", estimatedMin: 45 })]);
    expect(result.deadlines).toEqual([]);
    expect(result.backlog).toEqual([
      { taskId: "b", title: "Task b", estimatedMin: 45, priority: 2, plannedDate: "2026-09-07" },
    ]);
    expect(result.counts.critical).toBe(0);
  });

  test("done work is ignored entirely", () => {
    const result = forecast([task({ id: "c", status: "done", deadline: "2026-09-07" })]);
    expect(result.deadlines).toEqual([]);
  });
});

describe("capacity forecast — shared capacity and risk rules", () => {
  test("free time is allocated once, so competing deadlines cannot double-book it", () => {
    const result = forecast(
      [
        task({ id: "a", estimatedMin: 120, deadline: "2026-09-07" }),
        task({ id: "b", estimatedMin: 120, deadline: "2026-09-07" }),
      ],
      [day("2026-09-07", 120), day("2026-09-08", 120)],
    );
    const [first, second] = result.deadlines;
    expect(first!.plannedDate).toBe("2026-09-07");
    expect(second!.plannedDate).toBe("2026-09-08");
    expect(second!.status).toBe("critical");
    expect(second!.shortfallMinutes).toBe(120);
    expect(second!.reasons.join(" ")).toContain("after the deadline");
  });

  test("cumulative demand before a shared deadline is flagged and dated", () => {
    const result = forecast([
      task({ id: "a", estimatedMin: 120, deadline: "2026-09-08" }),
      task({ id: "b", estimatedMin: 120, deadline: "2026-09-08" }),
      task({ id: "c", estimatedMin: 120, deadline: "2026-09-08" }),
    ]);
    expect(result.firstOverloadedDate).toBe("2026-09-08");
    expect(result.counts.critical).toBeGreaterThan(0);
  });

  test("priority breaks ties between equal deadlines", () => {
    const ranked = rankForecastTasks([
      task({ id: "low", priority: 3, deadline: "2026-09-08" }),
      task({ id: "high", priority: 1, deadline: "2026-09-08" }),
    ]);
    expect(ranked.map((t) => t.id)).toEqual(["high", "low"]);
  });

  test("creation time then id keep ordering deterministic", () => {
    const ranked = rankForecastTasks([
      task({ id: "z", createdAt: "2026-09-02T00:00:00.000Z", deadline: "2026-09-08" }),
      task({ id: "a", createdAt: "2026-09-01T00:00:00.000Z", deadline: "2026-09-08" }),
      task({ id: "b", createdAt: "2026-09-01T00:00:00.000Z", deadline: "2026-09-08" }),
    ]);
    expect(ranked.map((t) => t.id)).toEqual(["a", "b", "z"]);
  });

  test("a fully booked horizon reports the work as unfittable", () => {
    const result = forecast(
      [task({ id: "a", estimatedMin: 90, deadline: "2026-09-08" })],
      [day("2026-09-07", 0, []), day("2026-09-08", 0, [])],
    );
    expect(result.deadlines[0]!.status).toBe("critical");
    expect(result.deadlines[0]!.reasons.join(" ")).toContain("No free working time");
  });

  test("work that fits the total but no single window is a contiguous-gap failure", () => {
    const result = forecast(
      [task({ id: "a", estimatedMin: 120, deadline: "2026-09-07" })],
      [day("2026-09-07", 0, [45, 45, 45])],
    );
    expect(result.deadlines[0]!.status).toBe("critical");
    expect(result.deadlines[0]!.reasons.join(" ")).toContain("in one sitting");
  });

  test("an overdue task is critical even when time exists", () => {
    const result = forecast([task({ id: "a", estimatedMin: 30, deadline: "2026-09-01" })]);
    expect(result.deadlines[0]!.status).toBe("critical");
    expect(result.deadlines[0]!.reasons[0]).toContain("Deadline passed");
  });

  test("a missed booked block is critical", () => {
    const result = forecast([
      task({
        id: "a",
        status: "scheduled",
        deadline: "2026-09-09",
        scheduledStart: "2026-09-07T09:00:00.000Z",
        scheduledEnd: "2026-09-07T10:00:00.000Z",
      }),
    ]);
    expect(result.deadlines[0]!.status).toBe("critical");
    expect(result.deadlines[0]!.reasons.join(" ")).toContain("already passed");
  });

  test("a block booked after its deadline is critical", () => {
    const result = forecast([
      task({
        id: "a",
        status: "scheduled",
        deadline: "2026-09-08",
        scheduledStart: "2026-09-09T09:00:00.000Z",
        scheduledEnd: "2026-09-09T10:00:00.000Z",
      }),
    ]);
    expect(result.deadlines[0]!.status).toBe("critical");
    expect(result.deadlines[0]!.reasons.join(" ")).toContain("after the deadline");
  });

  test("a live future block keeps its slot instead of competing for free time", () => {
    const result = forecast([
      task({
        id: "a",
        estimatedMin: 120,
        status: "scheduled",
        deadline: "2026-09-09",
        scheduledStart: "2026-09-08T09:00:00.000Z",
        scheduledEnd: "2026-09-08T11:00:00.000Z",
      }),
      task({ id: "b", estimatedMin: 120, deadline: "2026-09-09" }),
    ]);
    expect(result.deadlines.find((d) => d.taskId === "b")!.plannedDate).toBe("2026-09-07");
    expect(result.days[0]!.allocatedMinutes).toBe(120);
  });

  test("little room to spare is reported as tight, not critical", () => {
    const result = forecast(
      [task({ id: "a", estimatedMin: 90, deadline: "2026-09-07" })],
      [day("2026-09-07", 120), day("2026-09-08", 120)],
    );
    expect(result.deadlines[0]!.status).toBe("tight");
    expect(result.deadlines[0]!.reasons.join(" ")).toContain("spare before the deadline");
  });

  test("the deadline list is ordered deterministically", () => {
    const result = forecast([
      task({ id: "b", title: "Beta", deadline: "2026-09-09" }),
      task({ id: "a", title: "Alpha", deadline: "2026-09-08" }),
    ]);
    expect(result.deadlines.map((d) => d.title)).toEqual(["Alpha", "Beta"]);
  });

  test("status labels are plain words usable by assistive tech", () => {
    const result = forecast([task({ id: "a", estimatedMin: 30, deadline: "2026-09-01" })]);
    expect(["critical", "tight", "on-track"]).toContain(result.deadlines[0]!.status);
    expect(formatMinutes(95)).toBe("1h 35m");
  });
});

describe("capacity forecast — real day capacity from planner primitives", () => {
  test("lunch, travel and preparation reduce the day's capacity", () => {
    const busy = buildPlannerBusyIntervals(
      [
        {
          id: "appointment",
          title: "Dentist",
          starts_at: "2026-09-08T14:00:00.000Z",
          ends_at: "2026-09-08T15:00:00.000Z",
          location: "100 Main Street",
        },
      ],
      travel,
      30,
    );
    const gaps = computeGaps("2026-09-08", prefs, busy, Date.parse("2026-09-08T00:00:00Z"), 0);
    const capacity = gaps.reduce((sum, g) => sum + (g.end - g.start) / 60000, 0);
    // 8h working day − 45m lunch − (55m travel/prep + 60m appointment), where the
    // protected travel window (from 13:05) overlaps the last 10m of lunch.
    expect(capacity).toBe(480 - 45 - 115 + 10);
  });

  test("all-day markers do not consume working time", () => {
    const busy = buildPlannerBusyIntervals(
      [
        {
          id: "birthday",
          title: "Birthday",
          starts_at: "2026-09-08T00:00:00.000Z",
          ends_at: "2026-09-09T00:00:00.000Z",
          location: null,
          is_all_day: true,
        },
      ],
      travel,
      30,
    );
    expect(busy).toEqual([]);
  });

  test("planner profile assignments select the right profile for a date", () => {
    const assignments = [
      { profile_id: "holiday", start_date: "2026-09-10", end_date: "2026-09-12" },
      { profile_id: "work", start_date: "2026-09-01", end_date: "2026-09-30" },
    ];
    expect(resolveProfileIdForDate(assignments, "2026-09-11")).toBe("holiday");
    expect(resolveProfileIdForDate(assignments, "2026-09-08")).toBe("work");
    expect(resolveProfileIdForDate(assignments, "2026-10-08")).toBeNull();
  });

  test("day bounds follow the supplied local offset", () => {
    expect(localDayBounds("2026-09-08", 360)).toEqual({
      start: "2026-09-08T06:00:00.000Z",
      end: "2026-09-09T06:00:00.000Z",
    });
  });
});

describe("capacity forecast — timezones", () => {
  test("a malformed timezone falls back to UTC", () => {
    expect(normalizeTimeZone("Not/AZone")).toBe("UTC");
    expect(normalizeTimeZone("")).toBe("UTC");
    expect(normalizeTimeZone(undefined)).toBe("UTC");
    expect(normalizeTimeZone("America/Regina")).toBe("America/Regina");
  });

  test("non-hour offsets are handled", () => {
    expect(zoneOffsetMinutes("Asia/Kolkata", Date.parse("2026-09-07T00:00:00Z"))).toBe(-330);
    expect(zoneOffsetMinutes("Australia/Eucla", Date.parse("2026-09-07T00:00:00Z"))).toBe(-525);
  });

  test("a DST transition inside the horizon changes that day's offset", () => {
    const dates = forecastDates("America/New_York", Date.parse("2026-10-27T12:00:00Z"), 14);
    const before = dates.find((d) => d.date === "2026-10-28")!;
    const after = dates.find((d) => d.date === "2026-11-05")!;
    expect(before.offsetMinutes).toBe(240);
    expect(after.offsetMinutes).toBe(300);
    expect(dates).toHaveLength(14);
    expect(dates[0]!.date).toBe("2026-10-27");
  });

  test("local dates come from the user's zone, not the server's", () => {
    const lateUtc = Date.parse("2026-09-08T02:00:00Z");
    expect(localDateString("America/Regina", lateUtc)).toBe("2026-09-07");
    expect(localDateString("Asia/Tokyo", lateUtc)).toBe("2026-09-08");
  });
});

describe("capacity forecast — horizon scope", () => {
  test("a deadline beyond the horizon neither consumes capacity nor appears as a risk", () => {
    const result = forecast([
      task({ id: "far", estimatedMin: 300, deadline: "2026-12-01" }),
      task({ id: "near", estimatedMin: 60, deadline: "2026-09-09" }),
    ]);
    expect(result.deadlines.map((d) => d.taskId)).toEqual(["near"]);
    expect(result.backlog).toEqual([]);
    expect(result.counts).toMatchObject({ critical: 0, backlog: 0 });
    expect(result.deadlineRequiredMinutes).toBe(60);
    expect(result.days[0]!.allocatedMinutes).toBe(60);
    expect(result.firstOverloadedDate).toBeNull();
    expect(result.headline).toContain("fits");
  });

  test("a deadline on the last horizon day is still included", () => {
    const result = forecast([task({ id: "edge", estimatedMin: 60, deadline: "2026-09-09" })]);
    expect(result.deadlines).toHaveLength(1);
  });
});

describe("capacity forecast — already-booked work is not double-counted", () => {
  const booked = (overrides: Partial<ForecastTask> = {}) =>
    task({
      id: "booked",
      estimatedMin: 240,
      status: "scheduled",
      deadline: "2026-09-08",
      scheduledStart: "2026-09-08T09:00:00.000Z",
      scheduledEnd: "2026-09-08T13:00:00.000Z",
      ...overrides,
    });

  test("an on-time booked block is satisfied, not outstanding demand", () => {
    const result = forecast([booked()]);
    const entry = result.deadlines[0]!;
    expect(entry.alreadyBooked).toBe(true);
    expect(entry.outstandingMinutes).toBe(0);
    expect(entry.status).toBe("on-track");
    expect(result.deadlineRequiredMinutes).toBe(0);
    expect(result.firstOverloadedDate).toBeNull();
    expect(result.headline).not.toContain("won't be met");
  });

  test("a block after its deadline stays outstanding and critical", () => {
    const result = forecast([
      booked({
        deadline: "2026-09-07",
        scheduledStart: "2026-09-09T09:00:00.000Z",
        scheduledEnd: "2026-09-09T13:00:00.000Z",
      }),
    ]);
    const entry = result.deadlines[0]!;
    expect(entry.alreadyBooked).toBe(false);
    expect(entry.outstandingMinutes).toBe(240);
    expect(entry.shortfallMinutes).toBe(240);
    expect(entry.status).toBe("critical");
    expect(result.firstOverloadedDate).toBe("2026-09-07");
  });

  test("a missed block stays outstanding and critical", () => {
    const result = forecast([
      booked({
        deadline: "2026-09-09",
        scheduledStart: "2026-09-07T06:00:00.000Z",
        scheduledEnd: "2026-09-07T07:00:00.000Z",
      }),
    ]);
    const entry = result.deadlines[0]!;
    expect(entry.alreadyBooked).toBe(false);
    expect(entry.outstandingMinutes).toBe(240);
    expect(entry.status).toBe("critical");
  });

  test("mixed booked and unbooked demand counts only the unbooked part", () => {
    const result = forecast([
      booked(),
      task({ id: "open", estimatedMin: 90, deadline: "2026-09-08" }),
    ]);
    expect(result.deadlineRequiredMinutes).toBe(90);
    expect(result.counts.critical).toBe(0);
    expect(result.firstOverloadedDate).toBeNull();
  });
});

describe("capacity forecast — exact zoned instants", () => {
  test("spring forward: the local day is 23 hours and work times stay correct", () => {
    const { startMs, endMs } = localDayRange("America/New_York", "2026-03-08");
    expect((endMs - startMs) / 3600000).toBe(23);
    expect(new Date(zonedInstant("America/New_York", "2026-03-08", "09:00")).toISOString()).toBe(
      "2026-03-08T13:00:00.000Z",
    );
    expect(new Date(zonedInstant("America/New_York", "2026-03-07", "09:00")).toISOString()).toBe(
      "2026-03-07T14:00:00.000Z",
    );
  });

  test("fall back: the local day is 25 hours and midnight is not reused for work times", () => {
    const { startMs, endMs } = localDayRange("America/New_York", "2026-11-01");
    expect((endMs - startMs) / 3600000).toBe(25);
    expect(new Date(startMs).toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(new Date(zonedInstant("America/New_York", "2026-11-01", "09:00")).toISOString()).toBe(
      "2026-11-01T14:00:00.000Z",
    );
  });

  test("non-hour offsets resolve exactly", () => {
    expect(new Date(zonedInstant("Asia/Kolkata", "2026-09-08", "09:00")).toISOString()).toBe(
      "2026-09-08T03:30:00.000Z",
    );
    const kolkata = localDayRange("Asia/Kolkata", "2026-09-08");
    expect(new Date(kolkata.startMs).toISOString()).toBe("2026-09-07T18:30:00.000Z");
  });

  test("horizon days carry exact bounds across a transition", () => {
    const dates = forecastDates("America/New_York", Date.parse("2026-10-27T12:00:00Z"), 14);
    const fallback = dates.find((d) => d.date === "2026-11-01")!;
    expect((fallback.endMs - fallback.startMs) / 3600000).toBe(25);
  });
});

describe("capacity forecast — overlap filtering", () => {
  const overnight = { starts_at: "2026-09-07T22:00:00.000Z", ends_at: "2026-09-08T02:00:00.000Z" };

  test("an event crossing midnight belongs to both local days", () => {
    const first = localDayRange("UTC", "2026-09-07");
    const second = localDayRange("UTC", "2026-09-08");
    expect(overlapsRange(overnight, first.startMs, first.endMs)).toBe(true);
    expect(overlapsRange(overnight, second.startMs, second.endMs)).toBe(true);
  });

  test("an event starting before the horizon but overlapping it is kept", () => {
    const horizonStart = Date.parse("2026-09-07T00:00:00.000Z");
    const horizonEnd = Date.parse("2026-09-21T00:00:00.000Z");
    expect(
      overlapsRange(
        { starts_at: "2026-09-06T23:00:00.000Z", ends_at: "2026-09-07T01:00:00.000Z" },
        horizonStart,
        horizonEnd,
      ),
    ).toBe(true);
    expect(
      overlapsRange(
        { starts_at: "2026-09-06T20:00:00.000Z", ends_at: "2026-09-06T21:00:00.000Z" },
        horizonStart,
        horizonEnd,
      ),
    ).toBe(false);
  });

  test("a null end uses the default duration for overlap", () => {
    const day = localDayRange("UTC", "2026-09-08");
    expect(
      overlapsRange(
        { starts_at: "2026-09-07T23:50:00.000Z", ends_at: null },
        day.startMs,
        day.endMs,
      ),
    ).toBe(true);
    expect(
      overlapsRange(
        { starts_at: "2026-09-07T23:00:00.000Z", ends_at: null },
        day.startMs,
        day.endMs,
      ),
    ).toBe(false);
  });

  test("a busy interval clipped by computeGaps still removes only in-day time", () => {
    const busy = buildPlannerBusyIntervals(
      [
        {
          id: "overnight",
          title: "Night shift",
          starts_at: "2026-09-07T22:00:00.000Z",
          ends_at: "2026-09-08T10:00:00.000Z",
          location: null,
        },
      ],
      travel,
      30,
    );
    const gaps = computeGaps("2026-09-08", prefs, busy, Date.parse("2026-09-08T00:00:00Z"), 0);
    const capacity = gaps.reduce((sum, g) => sum + (g.end - g.start) / 60000, 0);
    // 09:00–17:00 minus the 09:00–10:00 spillover and the 45m lunch.
    expect(capacity).toBe(480 - 60 - 45);
  });
});

describe("capacity forecast — booked work is protected, not tight", () => {
  test("a day whose only free time is the reserved block raises no warning", () => {
    const result = forecast(
      [
        task({
          id: "booked",
          estimatedMin: 240,
          status: "scheduled",
          deadline: "2026-09-08",
          scheduledStart: "2026-09-08T09:00:00.000Z",
          scheduledEnd: "2026-09-08T13:00:00.000Z",
        }),
      ],
      [day("2026-09-07"), day("2026-09-08"), day("2026-09-09")],
    );
    const entry = result.deadlines[0]!;
    expect(entry.status).toBe("on-track");
    expect(entry.slackMinutes).toBe(0);
    expect(result.counts.tight).toBe(0);
    expect(result.counts.critical).toBe(0);
    expect(result.firstOverloadedDate).toBeNull();
  });
});

describe("linked task blocks", () => {
  const rows = [
    {
      id: "t1",
      title: "A",
      estimated_min: 60,
      priority: 1,
      deadline: null,
      status: "todo",
      created_at: "2026-01-01T00:00:00.000Z",
      scheduled_appointment_id: "a1",
    },
    {
      id: "t2",
      title: "B",
      estimated_min: null,
      priority: null,
      deadline: "2026-09-09",
      status: "todo",
      created_at: "2026-01-01T00:00:00.000Z",
      scheduled_appointment_id: null,
    },
    {
      id: "t3",
      title: "C",
      estimated_min: 30,
      priority: 2,
      deadline: null,
      status: "todo",
      created_at: "2026-01-01T00:00:00.000Z",
      scheduled_appointment_id: "a1",
    },
  ];

  test("collects distinct linked ids only", () => {
    expect(linkedBlockIds(rows)).toEqual(["a1"]);
    expect(linkedBlockIds([])).toEqual([]);
  });

  test("maps a block from years ago rather than treating it as unscheduled", () => {
    const mapped = mapForecastTasks(rows, [
      { id: "a1", starts_at: "2023-02-01T09:00:00.000Z", ends_at: "2023-02-01T10:00:00.000Z" },
    ]);
    expect(mapped[0]!.scheduledStart).toBe("2023-02-01T09:00:00.000Z");
    expect(mapped[1]!.scheduledStart).toBeNull();
    expect(mapped[1]!.estimatedMin).toBe(30);
    expect(mapped[2]!.scheduledEnd).toBe("2023-02-01T10:00:00.000Z");
  });
});
