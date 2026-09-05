import { describe, expect, it } from "vitest";
import {
  PREVIEW_TTL_MINUTES,
  canonicalPreviewPayload,
  previewIsExpired,
  selectApprovedMoves,
  type SignedMove,
} from "../src/lib/plan-preview";
import { signPreview, verifyPreview } from "../src/lib/plan-preview.server";

const secret = Buffer.from("test-signing-secret-value-0123456789", "utf8");

function move(overrides: Partial<SignedMove> = {}): SignedMove {
  return {
    appointmentId: "11111111-1111-4111-8111-111111111111",
    taskId: "22222222-2222-4222-8222-222222222222",
    title: "Draft proposal",
    version: "2026-01-02T08:00:00.000Z",
    fromStart: "2026-01-02T09:00:00.000Z",
    fromEnd: "2026-01-02T10:00:00.000Z",
    toStart: "2026-01-02T14:00:00.000Z",
    toEnd: "2026-01-02T15:00:00.000Z",
    reason: "missed",
    conflictsWith: null,
    ...overrides,
  };
}

const previewId = "33333333-3333-4333-8333-333333333333";
const date = "2026-01-02";
const generatedAt = "2026-01-02T08:30:00.000Z";

describe("proposal signing", () => {
  it("accepts the proposal it produced", () => {
    const moves = [move()];
    const sig = signPreview(previewId, date, generatedAt, moves, secret);
    expect(verifyPreview(previewId, date, generatedAt, moves, sig, secret)).toBe(true);
  });

  it("rejects a changed time", () => {
    const moves = [move()];
    const sig = signPreview(previewId, date, generatedAt, moves, secret);
    const tampered = [move({ toStart: "2026-01-02T06:00:00.000Z" })];
    expect(verifyPreview(previewId, date, generatedAt, tampered, sig, secret)).toBe(false);
  });

  it("rejects an added move", () => {
    const moves = [move()];
    const sig = signPreview(previewId, date, generatedAt, moves, secret);
    const extra = [move(), move({ appointmentId: "44444444-4444-4444-8444-444444444444" })];
    expect(verifyPreview(previewId, date, generatedAt, extra, sig, secret)).toBe(false);
  });

  it("rejects a signature from another proposal", () => {
    const sig = signPreview(previewId, date, generatedAt, [move()], secret);
    const other = "55555555-5555-4555-8555-555555555555";
    expect(verifyPreview(other, date, generatedAt, [move()], sig, secret)).toBe(false);
  });

  it("rejects an empty or malformed signature", () => {
    expect(verifyPreview(previewId, date, generatedAt, [move()], "", secret)).toBe(false);
    expect(verifyPreview(previewId, date, generatedAt, [move()], "abc", secret)).toBe(false);
  });

  it("keeps two different proposals apart", () => {
    const a = canonicalPreviewPayload(previewId, date, generatedAt, [move()]);
    const b = canonicalPreviewPayload(previewId, date, generatedAt, [move({ title: "Other" })]);
    expect(a).not.toBe(b);
  });
});

describe("proposal freshness", () => {
  const base = Date.parse(generatedAt);

  it("stays approvable inside the window", () => {
    expect(previewIsExpired(generatedAt, base + 60_000)).toBe(false);
  });

  it("expires past the window", () => {
    expect(previewIsExpired(generatedAt, base + (PREVIEW_TTL_MINUTES + 1) * 60_000)).toBe(true);
  });

  it("rejects a stamp from the future or an unreadable one", () => {
    expect(previewIsExpired(generatedAt, base - 10 * 60_000)).toBe(true);
    expect(previewIsExpired("not-a-date", base)).toBe(true);
  });
});

describe("approved selection", () => {
  it("keeps only the ticked blocks", () => {
    const a = move();
    const b = move({ appointmentId: "44444444-4444-4444-8444-444444444444" });
    expect(selectApprovedMoves([a, b], [b.appointmentId])).toEqual([b]);
  });

  it("refuses a block that was not proposed", () => {
    expect(() => selectApprovedMoves([move()], ["66666666-6666-4666-8666-666666666666"])).toThrow();
  });

  it("refuses duplicates and an empty approval", () => {
    const a = move();
    expect(() => selectApprovedMoves([a], [a.appointmentId, a.appointmentId])).toThrow();
    expect(() => selectApprovedMoves([a], [])).toThrow();
  });
});
