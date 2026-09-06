/**
 * Feature 4 — authenticated server functions for the learning layer.
 * Every query derives the user from the session; no submitted user_id is trusted.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { learningDb } from "./learning-db";
import {
  CONFLICT_STRATEGIES,
  acceptedStillSupported,
  deriveStrategySuggestion,
  isConflictStrategy,
  learningRetentionCutoffISO,
  summarizeActivity,
  type ActivitySummary,
  type ConflictStrategy,
  type LearningEvent,
  type LearningEventKind,
  type StrategySuggestion,
} from "./learning";

export type LearningOverview = {
  enabled: boolean;
  acceptedStrategy: ConflictStrategy | null;
  acceptedAt: string | null;
  acceptedSupported: boolean;
  suggestion: StrategySuggestion;
  activity: ActivitySummary;
  retentionDays: number;
};

export const getLearningOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LearningOverview> => {
    const db = learningDb(context.supabase);
    const now = Date.now();
    const [settingsRes, eventsRes] = await Promise.all([
      db
        .from("learning_settings")
        .select("enabled,accepted_conflict_strategy,accepted_at")
        .eq("user_id", context.userId)
        .maybeSingle(),
      db
        .from("learning_events")
        .select(
          "kind,conflict_strategy,offered_count,approved_count,moved_count,restored_count,left_alone_count,created_at",
        )
        .eq("user_id", context.userId)
        .gte("created_at", learningRetentionCutoffISO(now))
        .order("created_at", { ascending: false })
        .limit(500),
    ]);
    if (settingsRes.error) throw new Error("Your learning settings could not be loaded.");
    if (eventsRes.error) throw new Error("Your learning history could not be loaded.");

    const enabled = settingsRes.data?.enabled === true;
    const accepted = isConflictStrategy(settingsRes.data?.accepted_conflict_strategy)
      ? settingsRes.data.accepted_conflict_strategy
      : null;

    const events: LearningEvent[] = (eventsRes.data ?? []).map((row) => ({
      kind: row.kind as LearningEventKind,
      conflictStrategy: isConflictStrategy(row.conflict_strategy) ? row.conflict_strategy : null,
      offered: row.offered_count ?? 0,
      approved: row.approved_count ?? 0,
      moved: row.moved_count ?? 0,
      restored: row.restored_count ?? 0,
      leftAlone: row.left_alone_count ?? 0,
      createdAt: row.created_at,
    }));

    const suggestion = deriveStrategySuggestion(events, { enabled, nowMs: now });
    return {
      enabled,
      acceptedStrategy: accepted,
      acceptedAt: settingsRes.data?.accepted_at ?? null,
      acceptedSupported: acceptedStillSupported(accepted, suggestion),
      suggestion,
      activity: summarizeActivity(events, now),
      retentionDays: 180,
    };
  });

export const setLearningEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ enabled: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = learningDb(context.supabase);
    const { error } = await db
      .from("learning_settings")
      .upsert(
        { user_id: context.userId, enabled: data.enabled },
        { onConflict: "user_id" },
      );
    if (error) throw new Error("That setting could not be saved. Please try again.");
    return { enabled: data.enabled };
  });

const strategySchema = z.object({ strategy: z.enum(CONFLICT_STRATEGIES) });

export const acceptLearnedStrategy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => strategySchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = learningDb(context.supabase);
    const { error } = await db.from("learning_settings").upsert(
      {
        user_id: context.userId,
        enabled: true,
        accepted_conflict_strategy: data.strategy,
        accepted_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error("That preference could not be saved. Please try again.");
    return { acceptedStrategy: data.strategy };
  });

export const clearLearnedStrategy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = learningDb(context.supabase);
    const { error } = await db
      .from("learning_settings")
      .update({ accepted_conflict_strategy: null, accepted_at: null })
      .eq("user_id", context.userId);
    if (error) throw new Error("That preference could not be removed. Please try again.");
    return { acceptedStrategy: null };
  });

/**
 * Deletes this user's learning history and accepted learned preference only.
 * Appointments, tasks, planner profiles, plan history and connected providers
 * are untouched.
 */
export const resetLearningData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = learningDb(context.supabase);
    const { data, error } = await db.rpc("reset_learning_data");
    if (error) throw new Error("Your learning data could not be cleared. Please try again.");
    const payload = (data ?? {}) as { deletedEvents?: number };
    return { deletedEvents: payload.deletedEvents ?? 0 };
  });
