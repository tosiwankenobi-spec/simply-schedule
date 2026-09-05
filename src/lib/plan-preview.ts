/**
 * Pure helpers that bind an approved replan to the exact proposal the server
 * produced. The browser can choose which blocks to approve, but it can never
 * invent a move, change a time, or replay an old proposal: every field the
 * database acts on is covered by the signature checked on the server.
 */
import type { ReplanMove } from "./replan-day";

/** Minutes a proposal stays approvable before it must be worked out again. */
export const PREVIEW_TTL_MINUTES = 10;

export type SignedMove = ReplanMove & {
  /** The block's last-changed stamp when the proposal was worked out. */
  version: string;
};

/**
 * A stable, unambiguous string covering everything the apply step relies on.
 * Field order is fixed and values are separated by characters that cannot
 * appear in them, so two different proposals can never produce one payload.
 */
export function canonicalPreviewPayload(
  previewId: string,
  date: string,
  generatedAt: string,
  moves: SignedMove[],
): string {
  const rows = moves.map((move) =>
    [
      move.appointmentId,
      move.taskId,
      move.version,
      move.fromStart,
      move.fromEnd,
      move.toStart,
      move.toEnd,
      move.reason,
    ].join("\u001f"),
  );
  return [previewId, date, generatedAt, String(moves.length), ...rows].join("\u001e");
}

export class PreviewExpiredError extends Error {
  constructor() {
    super("That proposal is out of date. Check your day again before approving.");
    this.name = "PreviewExpiredError";
  }
}

/** A proposal older than the time-to-live can no longer be approved. */
export function previewIsExpired(generatedAt: string, nowMs: number, ttlMinutes = PREVIEW_TTL_MINUTES) {
  const generated = Date.parse(generatedAt);
  if (!Number.isFinite(generated)) return true;
  return nowMs - generated > ttlMinutes * 60_000 || generated - nowMs > 60_000;
}

/**
 * Narrow the signed proposal to the blocks the person approved. Anything not
 * in the original proposal is rejected rather than quietly ignored.
 */
export function selectApprovedMoves(moves: SignedMove[], approvedIds: string[]): SignedMove[] {
  const unique = new Set(approvedIds);
  if (unique.size !== approvedIds.length) {
    throw new Error("The same block cannot be approved twice.");
  }
  const byId = new Map(moves.map((move) => [move.appointmentId, move]));
  const selected = approvedIds.map((id) => {
    const move = byId.get(id);
    if (!move) throw new Error("That block was not part of the proposal you were shown.");
    return move;
  });
  if (selected.length === 0) throw new Error("Choose at least one block to move.");
  return selected;
}
