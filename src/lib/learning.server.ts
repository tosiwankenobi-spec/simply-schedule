/**
 * Best-effort, server-side recording of learning signals.
 *
 * Recording never turns a successful scheduling action into a visible failure:
 * every call swallows its error. Failures are logged in development only, and
 * the log carries no user data — just the event kind.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { learningDb } from "./learning-db";
import { clampCount, isConflictStrategy, type ConflictStrategy, type LearningEventKind } from "./learning";

type Client = SupabaseClient<Database>;

export type LearningSignal = {
  kind: LearningEventKind;
  conflictStrategy?: ConflictStrategy | null;
  offered?: number;
  approved?: number;
  moved?: number;
  restored?: number;
  leftAlone?: number;
  localHour?: number | null;
  localDow?: number | null;
};

function bucket(value: number | null | undefined, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = Math.trunc(value);
  return n >= 0 && n <= max ? n : null;
}

/**
 * Records one allowlisted decision event. The database RPC re-validates and
 * drops the event entirely when the user has not enabled learning.
 */
export async function recordLearningSignal(
  supabase: Client,
  signal: LearningSignal,
): Promise<void> {
  try {
    const strategy =
      signal.kind === "plan_applied" && isConflictStrategy(signal.conflictStrategy)
        ? signal.conflictStrategy
        : null;
    if (signal.kind === "plan_applied" && !strategy) return;

    const { error } = await learningDb(supabase).rpc("record_learning_event", {
      p_kind: signal.kind,
      p_conflict_strategy: strategy,
      p_offered: clampCount(signal.offered),
      p_approved: clampCount(signal.approved),
      p_moved: clampCount(signal.moved),
      p_restored: clampCount(signal.restored),
      p_left_alone: clampCount(signal.leftAlone),
      p_local_hour: bucket(signal.localHour, 23),
      p_local_dow: bucket(signal.localDow, 6),
    });
    if (error) throw error;
  } catch {
    if (process.env["NODE_ENV"] !== "production") {
      // No payload, no identifiers — just enough to notice in development.
      console.warn(`[learning] could not record "${signal.kind}" event`);
    }
  }
}
