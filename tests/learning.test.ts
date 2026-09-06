import { describe, expect, it } from "vitest";
import {
  LEARNING_RETENTION_DAYS,
  MIN_STRATEGY_EVENTS,
  acceptedStillSupported,
  clampCount,
  deriveStrategySuggestion,
  learningRetentionCutoffISO,
  summarizeActivity,
  withinRetention,
  type ConflictStrategy,
  type LearningEvent,
} from "@/lib/learning";

const NOW = Date.parse("2026-09-06T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function applied(strategy: ConflictStrategy, daysAgo = 1): LearningEvent {
  return {
    kind: "plan_applied",
    conflictStrategy: strategy,
    offered: 0,
    approved: 0,
    moved: 0,
    restored: 0,
    leftAlone: 0,
    createdAt: new Date(NOW - daysAgo * DAY).toISOString(),
  };
}

describe("conflict strategy rules", () => {
  it("says nothing while learning is off, even with plenty of evidence", () => {
    const events = [applied("shift"), applied("shift"), applied("shift"), applied("shift")];
    expect(deriveStrategySuggestion(events, { enabled: false, nowMs: NOW })).toEqual({
      status: "disabled",
    });
  });

  it("needs at least three applications", () => {
    const events = [applied("shift"), applied("shift")];
    expect(deriveStrategySuggestion(events, { enabled: true, nowMs: NOW })).toEqual({
      status: "insufficient",
      total: 2,
      needed: 1,
    });
    expect(MIN_STRATEGY_EVENTS).toBe(3);
  });

  it("reports no evidence at all as insufficient", () => {
    expect(deriveStrategySuggestion([], { enabled: true, nowMs: NOW })).toEqual({
      status: "insufficient",
      total: 0,
      needed: 3,
    });
  });

  it("suggests exactly at the 70% boundary", () => {
    const events = [
      ...Array.from({ length: 7 }, () => applied("skip")),
      applied("shift"),
      applied("shift"),
      applied("force"),
    ];
    const result = deriveStrategySuggestion(events, { enabled: true, nowMs: NOW });
    expect(result).toMatchObject({ status: "suggested", strategy: "skip", count: 7, total: 10, percent: 70 });
  });

  it("stays silent just below the 70% boundary", () => {
    const events = [
      ...Array.from({ length: 6 }, () => applied("skip")),
      ...Array.from({ length: 4 }, () => applied("shift")),
    ];
    expect(deriveStrategySuggestion(events, { enabled: true, nowMs: NOW }).status).toBe("no-winner");
  });

  it("refuses a tie", () => {
    const events = [applied("shift"), applied("shift"), applied("skip"), applied("skip")];
    const result = deriveStrategySuggestion(events, { enabled: true, nowMs: NOW });
    expect(result.status).toBe("no-winner");
  });

  it("ignores replan and undo events when tallying strategies", () => {
    const events: LearningEvent[] = [
      applied("force"),
      applied("force"),
      applied("force"),
      {
        kind: "replan_applied",
        conflictStrategy: null,
        offered: 4,
        approved: 2,
        moved: 2,
        restored: 0,
        leftAlone: 0,
        createdAt: new Date(NOW - DAY).toISOString(),
      },
    ];
    expect(deriveStrategySuggestion(events, { enabled: true, nowMs: NOW })).toMatchObject({
      status: "suggested",
      strategy: "force",
      total: 3,
      percent: 100,
    });
  });
});

describe("retention", () => {
  it("drops events older than the retention window", () => {
    const events = [applied("shift", 1), applied("shift", LEARNING_RETENTION_DAYS + 1)];
    expect(withinRetention(events, NOW)).toHaveLength(1);
  });

  it("an old majority cannot keep producing a suggestion", () => {
    const events = [
      applied("skip", 200),
      applied("skip", 200),
      applied("skip", 200),
      applied("shift", 2),
    ];
    expect(deriveStrategySuggestion(events, { enabled: true, nowMs: NOW })).toEqual({
      status: "insufficient",
      total: 1,
      needed: 2,
    });
  });

  it("computes a 180-day cutoff", () => {
    expect(learningRetentionCutoffISO(NOW)).toBe(new Date(NOW - 180 * DAY).toISOString());
  });
});

describe("accepted default staleness", () => {
  it("is supported while evidence agrees", () => {
    const suggestion = deriveStrategySuggestion(
      [applied("shift"), applied("shift"), applied("shift")],
      { enabled: true, nowMs: NOW },
    );
    expect(acceptedStillSupported("shift", suggestion)).toBe(true);
  });

  it("is flagged when recent evidence points elsewhere — without changing it", () => {
    const suggestion = deriveStrategySuggestion(
      [applied("skip"), applied("skip"), applied("skip")],
      { enabled: true, nowMs: NOW },
    );
    expect(acceptedStillSupported("shift", suggestion)).toBe(false);
    expect(suggestion).toMatchObject({ status: "suggested", strategy: "skip" });
  });

  it("is not flagged when there is no clear winner", () => {
    const suggestion = deriveStrategySuggestion(
      [applied("skip"), applied("skip"), applied("shift"), applied("shift")],
      { enabled: true, nowMs: NOW },
    );
    expect(acceptedStillSupported("shift", suggestion)).toBe(true);
  });
});

describe("activity summary", () => {
  it("aggregates counts only", () => {
    const events: LearningEvent[] = [
      applied("shift"),
      {
        kind: "replan_applied",
        conflictStrategy: null,
        offered: 5,
        approved: 3,
        moved: 3,
        restored: 0,
        leftAlone: 0,
        createdAt: new Date(NOW - DAY).toISOString(),
      },
      {
        kind: "undo_completed",
        conflictStrategy: null,
        offered: 0,
        approved: 0,
        moved: 0,
        restored: 2,
        leftAlone: 1,
        createdAt: new Date(NOW - DAY).toISOString(),
      },
    ];
    expect(summarizeActivity(events, NOW)).toEqual({
      plansApplied: 1,
      replansApproved: 1,
      blocksOffered: 5,
      blocksApproved: 3,
      blocksMoved: 3,
      undos: 1,
      blocksRestored: 2,
      blocksLeftAlone: 1,
    });
  });
});

describe("count clamping", () => {
  it("keeps values inside the range the database accepts", () => {
    expect(clampCount(-5)).toBe(0);
    expect(clampCount(10_000)).toBe(500);
    expect(clampCount(undefined)).toBe(0);
    expect(clampCount(Number.NaN)).toBe(0);
    expect(clampCount(3.6)).toBe(4);
  });
});
