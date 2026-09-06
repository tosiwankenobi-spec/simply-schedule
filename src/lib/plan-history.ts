/**
 * Pure helpers for the replan audit trail and undo.
 *
 * A plan run stores the minimum before/after data needed to explain and undo a
 * replan: which flexible block moved, from when, to when, and why. It never
 * stores notes, locations, provider identifiers, tokens or any connection data.
 */

export const PLAN_HISTORY_RETENTION_DAYS = 60;

export type PlanChange = {
  appointmentId: string;
  taskId: string;
  title: string;
  fromStart: string;
  fromEnd: string;
  toStart: string;
  toEnd: string;
  reason: "missed" | "conflict";
  /** The block's version stamp right after the plan moved it, when recorded. */
  appliedVersion?: string;
};


export type PlanRunSummary = {
  id: string;
  planDate: string;
  appliedAt: string;
  undoneAt: string | null;
  summary: string;
  changes: PlanChange[];
};

export type UndoOutcome = "restore" | "already-restored" | "changed-since" | "missing";

export type UndoLine = {
  change: PlanChange;
  outcome: UndoOutcome;
  explanation: string;
};

export type CurrentBlock = {
  id: string;
  starts_at: string;
  ends_at: string | null;
} | null;

const sameInstant = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a) && Boolean(b) && Date.parse(a as string) === Date.parse(b as string);

/** Decide what undoing a single change would do, given the block's current state. */
export function classifyUndo(change: PlanChange, current: CurrentBlock): UndoLine {
  if (!current) {
    return {
      change,
      outcome: "missing",
      explanation: "This block no longer exists, so there is nothing to put back.",
    };
  }
  if (sameInstant(current.starts_at, change.fromStart) && sameInstant(current.ends_at, change.fromEnd)) {
    return {
      change,
      outcome: "already-restored",
      explanation: "Already back at its original time.",
    };
  }
  if (sameInstant(current.starts_at, change.toStart) && sameInstant(current.ends_at, change.toEnd)) {
    return { change, outcome: "restore", explanation: "Will move back to its original time." };
  }
  return {
    change,
    outcome: "changed-since",
    explanation: "You changed this block after the plan was applied, so it will be left alone.",
  };
}

export function summarizeUndo(lines: UndoLine[]) {
  return {
    restore: lines.filter((line) => line.outcome === "restore").length,
    alreadyRestored: lines.filter((line) => line.outcome === "already-restored").length,
    changedSince: lines.filter((line) => line.outcome === "changed-since").length,
    missing: lines.filter((line) => line.outcome === "missing").length,
  };
}

export function summarizePlan(changes: PlanChange[]) {
  if (changes.length === 0) return "No blocks moved.";
  const missed = changes.filter((change) => change.reason === "missed").length;
  const conflict = changes.length - missed;
  const parts = [
    `${changes.length} block${changes.length === 1 ? "" : "s"} moved`,
    missed > 0 ? `${missed} missed` : null,
    conflict > 0 ? `${conflict} conflicting` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

export function retentionCutoffISO(nowMs: number, days = PLAN_HISTORY_RETENTION_DAYS) {
  return new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Narrow untrusted jsonb from the database into change records we can render. */
export function parsePlanChanges(value: unknown): PlanChange[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const strings = ["appointmentId", "taskId", "title", "fromStart", "fromEnd", "toStart", "toEnd"];
    if (strings.some((field) => typeof row[field] !== "string")) return [];
    const reason = row['reason'] === "missed" || row['reason'] === "conflict" ? row['reason'] : "conflict";
    return [
      {
        appointmentId: row['appointmentId'] as string,
        taskId: row['taskId'] as string,
        title: row['title'] as string,
        fromStart: row['fromStart'] as string,
        fromEnd: row['fromEnd'] as string,
        toStart: row['toStart'] as string,
        toEnd: row['toEnd'] as string,
        reason,
      },
    ];
  });
}
