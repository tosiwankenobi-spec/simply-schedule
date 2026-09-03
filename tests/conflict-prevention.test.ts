import { describe, expect, test } from "bun:test";
import { findPlacementConflicts, rankPlacementAlternatives } from "../src/lib/conflict-prevention";

describe("appointment conflict prevention", () => {
  test("finds overlaps but permits back-to-back and ignores all-day items", () => {
    const events = [
      {
        id: "a",
        title: "Standup",
        starts_at: "2026-09-03T16:00:00Z",
        ends_at: "2026-09-03T17:00:00Z",
      },
      {
        id: "b",
        title: "All day",
        starts_at: "2026-09-03T00:00:00Z",
        ends_at: "2026-09-04T00:00:00Z",
        is_all_day: true,
      },
    ];

    expect(
      findPlacementConflicts("2026-09-03T16:30:00Z", "2026-09-03T17:30:00Z", events),
    ).toHaveLength(1);
    expect(
      findPlacementConflicts("2026-09-03T17:00:00Z", "2026-09-03T17:30:00Z", events),
    ).toHaveLength(0);
  });

  test("excludes the appointment being moved", () => {
    const events = [
      {
        id: "self",
        title: "Movable",
        starts_at: "2026-09-03T16:00:00Z",
        ends_at: "2026-09-03T17:00:00Z",
      },
    ];
    expect(
      findPlacementConflicts("2026-09-03T16:00:00Z", "2026-09-03T17:00:00Z", events, "self"),
    ).toEqual([]);
  });

  test("ranks the nearest earlier and later safe openings", () => {
    const alternatives = rankPlacementAlternatives("2026-09-03T16:00:00Z", "2026-09-03T17:00:00Z", [
      { start: Date.parse("2026-09-03T14:00:00Z"), end: Date.parse("2026-09-03T16:00:00Z") },
      { start: Date.parse("2026-09-03T17:30:00Z"), end: Date.parse("2026-09-03T20:00:00Z") },
    ]);

    expect(alternatives.map((item) => item.startsAt)).toEqual([
      "2026-09-03T15:00:00.000Z",
      "2026-09-03T17:30:00.000Z",
    ]);
    expect(alternatives.map((item) => item.direction)).toEqual(["earlier", "later"]);
  });
});
