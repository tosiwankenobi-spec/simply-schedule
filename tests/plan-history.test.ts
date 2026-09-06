/**
 * Undo preview must predict exactly what the database will do, so a
 * confirmation never promises a move that undo would refuse.
 */
import { describe, expect, it } from "vitest";
import { classifyUndo, instantMicros, parsePlanChanges, type CurrentBlock, type PlanChange } from "../src/lib/plan-history";

const APPLIED_VERSION = "2026-01-02T14:05:00.000Z";

function change(overrides: Partial<PlanChange> = {}): PlanChange {
  return {
    appointmentId: "11111111-1111-4111-8111-111111111111",
    taskId: "22222222-2222-4222-8222-222222222222",
    title: "Draft proposal",
    fromStart: "2026-01-02T09:00:00.000Z",
    fromEnd: "2026-01-02T10:00:00.000Z",
    toStart: "2026-01-02T14:00:00.000Z",
    toEnd: "2026-01-02T15:00:00.000Z",
    reason: "missed",
    appliedVersion: APPLIED_VERSION,
    ...overrides,
  };
}

function block(overrides: Partial<NonNullable<CurrentBlock>> = {}): CurrentBlock {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    starts_at: "2026-01-02T14:00:00.000Z",
    ends_at: "2026-01-02T15:00:00.000Z",
    commitment_type: "flexible",
    is_all_day: false,
    updated_at: APPLIED_VERSION,
    ...overrides,
  };
}

describe("undo preview eligibility", () => {
  it("offers to put back an untouched moved block", () => {
    expect(classifyUndo(change(), block()).outcome).toBe("restore");
  });

  it("keeps a newer edit even when the times still match", () => {
    const line = classifyUndo(change(), block({ updated_at: "2026-01-02T16:30:00.000Z" }));
    expect(line.outcome).toBe("changed-since");
    expect(line.explanation).toMatch(/edited this block/i);
  });

  it("leaves a block that is now a fixed commitment alone", () => {
    const line = classifyUndo(change(), block({ commitment_type: "fixed" }));
    expect(line.outcome).toBe("changed-since");
    expect(line.explanation).toMatch(/fixed commitment/i);
  });

  it("leaves a block that is now all-day alone", () => {
    const line = classifyUndo(change(), block({ is_all_day: true }));
    expect(line.outcome).toBe("changed-since");
    expect(line.explanation).toMatch(/all-day/i);
  });

  it("still works for older history without a recorded version", () => {
    const { appliedVersion: _omit, ...older } = change();
    expect(classifyUndo(older as PlanChange, block({ updated_at: "2026-02-01T00:00:00.000Z" })).outcome).toBe(
      "restore",
    );
  });

  it("reports a deleted block as missing and a restored one as already back", () => {
    expect(classifyUndo(change(), null).outcome).toBe("missing");
    expect(
      classifyUndo(
        change(),
        block({ starts_at: "2026-01-02T09:00:00.000Z", ends_at: "2026-01-02T10:00:00.000Z" }),
      ).outcome,
    ).toBe("already-restored");
  });
});

describe("stored change records", () => {
  it("carries the recorded version through", () => {
    const [parsed] = parsePlanChanges([change()]);
    expect(parsed?.appliedVersion).toBe(APPLIED_VERSION);
  });

  it("tolerates a record saved before versions were stored", () => {
    const { appliedVersion: _omit, ...older } = change();
    const [parsed] = parsePlanChanges([older]);
    expect(parsed?.appliedVersion).toBeUndefined();
    expect(parsed?.title).toBe("Draft proposal");
  });
});

describe("microsecond-precision versions", () => {
  const MICRO_VERSION = "2026-01-02T14:05:00.123456Z";

  it("restores an untouched block whose version has non-zero microseconds", () => {
    const line = classifyUndo(
      change({ appliedVersion: MICRO_VERSION }),
      block({ updated_at: MICRO_VERSION }),
    );
    expect(line.outcome).toBe("restore");
  });

  it("keeps a newer metadata edit that differs only by microseconds", () => {
    const line = classifyUndo(
      change({ appliedVersion: MICRO_VERSION }),
      block({ updated_at: "2026-01-02T14:05:00.123789Z" }),
    );
    expect(line.outcome).toBe("changed-since");
    expect(line.explanation).toMatch(/edited this block/i);
  });

  it("measures instants losslessly to whole microseconds", () => {
    expect(instantMicros("2026-01-02T14:05:00.123456Z")).toBe(
      Date.parse("2026-01-02T14:05:00Z") * 1000 + 123456,
    );
    expect(instantMicros("2026-01-02T14:05:00+00:00")).toBe(Date.parse("2026-01-02T14:05:00Z") * 1000);
    expect(instantMicros("not a date")).toBeNull();
  });
});
