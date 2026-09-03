import { describe, expect, test } from "bun:test";
import {
  annualOccurrenceDate,
  generateRoutineOccurrences,
  routineCadenceLabel,
  type RoutineDefinition,
} from "../src/lib/routines";

const annualRoutine: RoutineDefinition = {
  id: "routine-1",
  title: "Avery's birthday",
  category: "birthday",
  frequency: "yearly",
  days_of_week: [],
  annual_month: 2,
  annual_day: 29,
  local_time: "00:00:00",
  duration_min: 30,
  start_date: "2020-01-01",
  end_date: null,
  timezone: "America/Regina",
  location: null,
  notes: null,
  commitment_type: "fixed",
  is_all_day: true,
  active: true,
};

describe("annual routines", () => {
  test("observes February 29 on February 28 outside leap years", () => {
    expect(annualOccurrenceDate(2027, 2, 29)).toBe("2027-02-28");
    expect(annualOccurrenceDate(2028, 2, 29)).toBe("2028-02-29");
  });

  test("materializes the next annual occurrence as a local all-day event", () => {
    const occurrences = generateRoutineOccurrences(annualRoutine, "2026-09-03");
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toEqual({
      occurrenceDate: "2027-02-28",
      startsAt: "2027-02-28T06:00:00.000Z",
      endsAt: "2027-03-01T06:00:00.000Z",
      recurrenceRule: "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29",
    });
  });

  test("labels leap-day handling clearly", () => {
    expect(routineCadenceLabel(annualRoutine)).toBe(
      "Every year on February 29 (February 28 in non-leap years)",
    );
  });

  test("keeps daily routines on the existing six-week window", () => {
    const daily: RoutineDefinition = {
      ...annualRoutine,
      category: "medication",
      frequency: "daily",
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      annual_month: null,
      annual_day: null,
      is_all_day: false,
      local_time: "09:00:00",
    };
    expect(generateRoutineOccurrences(daily, "2026-09-03")).toHaveLength(42);
  });
});
