/**
 * Feature 4 — learning from user decisions (pure deterministic rules).
 *
 * Privacy contract: only the categorical/numeric fields below ever exist here.
 * No titles, notes, locations, provider ids, message content, or row ids.
 */

export const CONFLICT_STRATEGIES = ["shift", "skip", "force"] as const;
export type ConflictStrategy = (typeof CONFLICT_STRATEGIES)[number];

export const LEARNING_EVENT_KINDS = ["plan_applied", "replan_applied", "undo_completed"] as const;
export type LearningEventKind = (typeof LEARNING_EVENT_KINDS)[number];

/** Bounded retention for learning history. */
export const LEARNING_RETENTION_DAYS = 180;
/** Minimum completed plan applications before a suggestion appears. */
export const MIN_STRATEGY_EVENTS = 3;
/** Minimum share of applications agreeing on one strategy. */
export const STRATEGY_AGREEMENT = 0.7;

export type LearningEvent = {
  kind: LearningEventKind;
  conflictStrategy: ConflictStrategy | null;
  offered: number;
  approved: number;
  moved: number;
  restored: number;
  leftAlone: number;
  createdAt: string;
};

export function isConflictStrategy(value: unknown): value is ConflictStrategy {
  return typeof value === "string" && (CONFLICT_STRATEGIES as readonly string[]).includes(value);
}

export function learningRetentionCutoffISO(nowMs: number, days = LEARNING_RETENTION_DAYS): string {
  return new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Events still inside the retention window, oldest dropped. */
export function withinRetention(events: LearningEvent[], nowMs: number): LearningEvent[] {
  const cutoff = nowMs - LEARNING_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return events.filter((event) => {
    const at = Date.parse(event.createdAt);
    return Number.isFinite(at) && at >= cutoff;
  });
}

export type StrategySuggestion =
  | { status: "disabled" }
  | { status: "insufficient"; total: number; needed: number }
  | { status: "no-winner"; total: number; counts: Record<ConflictStrategy, number> }
  | {
      status: "suggested";
      strategy: ConflictStrategy;
      count: number;
      total: number;
      /** Whole-number percentage of applications choosing this strategy. */
      percent: number;
      counts: Record<ConflictStrategy, number>;
    };

export function tallyStrategies(events: LearningEvent[]): Record<ConflictStrategy, number> {
  const counts: Record<ConflictStrategy, number> = { shift: 0, skip: 0, force: 0 };
  for (const event of events) {
    if (event.kind !== "plan_applied") continue;
    if (!isConflictStrategy(event.conflictStrategy)) continue;
    counts[event.conflictStrategy] += 1;
  }
  return counts;
}

/**
 * Deterministic rule: at least MIN_STRATEGY_EVENTS applications in the retained
 * history, at least STRATEGY_AGREEMENT of them on one strategy, and that
 * strategy must be a unique winner.
 */
export function deriveStrategySuggestion(
  events: LearningEvent[],
  options: { enabled: boolean; nowMs: number },
): StrategySuggestion {
  if (!options.enabled) return { status: "disabled" };
  const retained = withinRetention(events, options.nowMs);
  const counts = tallyStrategies(retained);
  const total = counts.shift + counts.skip + counts.force;
  if (total < MIN_STRATEGY_EVENTS) {
    return { status: "insufficient", total, needed: MIN_STRATEGY_EVENTS - total };
  }
  const best = Math.max(counts.shift, counts.skip, counts.force);
  const winners = CONFLICT_STRATEGIES.filter((s) => counts[s] === best);
  if (winners.length !== 1) return { status: "no-winner", total, counts };
  const strategy = winners[0]!;
  const share = best / total;
  // Guard floating point at the 70% boundary (e.g. 7/10).
  if (share + 1e-9 < STRATEGY_AGREEMENT) return { status: "no-winner", total, counts };
  return {
    status: "suggested",
    strategy,
    count: best,
    total,
    percent: Math.round(share * 100),
    counts,
  };
}

/**
 * Is a previously accepted default still supported by recent evidence?
 * Never used to change the default — only to say so plainly.
 */
export function acceptedStillSupported(
  accepted: ConflictStrategy | null,
  suggestion: StrategySuggestion,
): boolean {
  if (!accepted) return true;
  if (suggestion.status !== "suggested") return true;
  return suggestion.strategy === accepted;
}

export type ActivitySummary = {
  plansApplied: number;
  replansApproved: number;
  blocksOffered: number;
  blocksApproved: number;
  blocksMoved: number;
  undos: number;
  blocksRestored: number;
  blocksLeftAlone: number;
};

export function summarizeActivity(events: LearningEvent[], nowMs: number): ActivitySummary {
  const retained = withinRetention(events, nowMs);
  const summary: ActivitySummary = {
    plansApplied: 0,
    replansApproved: 0,
    blocksOffered: 0,
    blocksApproved: 0,
    blocksMoved: 0,
    undos: 0,
    blocksRestored: 0,
    blocksLeftAlone: 0,
  };
  for (const event of retained) {
    if (event.kind === "plan_applied") summary.plansApplied += 1;
    if (event.kind === "replan_applied") {
      summary.replansApproved += 1;
      summary.blocksOffered += event.offered;
      summary.blocksApproved += event.approved;
      summary.blocksMoved += event.moved;
    }
    if (event.kind === "undo_completed") {
      summary.undos += 1;
      summary.blocksRestored += event.restored;
      summary.blocksLeftAlone += event.leftAlone;
    }
  }
  return summary;
}

/** Clamp a count into the range the database accepts. */
export function clampCount(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
  return Math.min(500, Math.max(0, n));
}
