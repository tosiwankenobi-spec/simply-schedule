import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  buildDayReplan,
  intervalsOverlap,
  localTimeMs,
  type ReplanAppointment,
  type ReplanPreview,
} from "./replan-day";
import {
  PreviewExpiredError,
  previewIsExpired,
  selectApprovedMoves,
  type SignedMove,
} from "./plan-preview";
import type { PlannerScheduleEvent, TaskRow } from "./tasks.server";
import {
  classifyUndo,
  parsePlanChanges,
  retentionCutoffISO,
  summarizeUndo,
  type PlanChange,
  type PlanRunSummary,
  type UndoLine,
} from "./plan-history";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const contextSchema = z.object({
  date: dateSchema,
  timezoneOffsetMinutes: z.number().int().min(-900).max(900),
});

function dayBounds(date: string, timezoneOffsetMinutes: number) {
  const start = localTimeMs(date, "00:00", timezoneOffsetMinutes);
  return { start, end: start + 24 * 60 * 60 * 1000 };
}

async function loadProtectedSchedule(
  supabase: SupabaseClient<Database>,
  userId: string,
  date: string,
  timezoneOffsetMinutes: number,
  defaultDurationMin: number,
) {
  const [tasksServer, notificationsServer, travelIntelligence] = await Promise.all([
    import("./tasks.server"),
    import("./notifications.server"),
    import("./travel-intelligence"),
  ]);
  const bounds = tasksServer.localDayBounds(date, timezoneOffsetMinutes);
  const [scheduleResult, ownMetadataResult, notificationResult] = await Promise.all([
    supabase
      .from("schedule_hub_events")
      .select("id,title,starts_at,ends_at,location,is_all_day")
      .gte("starts_at", bounds.start)
      .lt("starts_at", bounds.end)
      .order("starts_at"),
    supabase
      .from("appointments")
      .select("id,travel_minutes,preparation_minutes")
      .eq("user_id", userId)
      .gte("starts_at", bounds.start)
      .lt("starts_at", bounds.end),
    supabase
      .from("notification_prefs")
      .select(notificationsServer.NOTIF_COLS)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (scheduleResult.error || ownMetadataResult.error || notificationResult.error) {
    throw new Error("Your unified schedule could not be rechecked. Please try again.");
  }

  const ownMetadata = new Map(
    (ownMetadataResult.data ?? []).map((appointment) => [appointment.id, appointment]),
  );
  const schedule = (scheduleResult.data ?? []).flatMap((appointment) => {
    if (!appointment.id || !appointment.starts_at) return [];
    const metadata = ownMetadata.get(appointment.id);
    return [
      {
        id: appointment.id,
        title: appointment.title || "Busy",
        starts_at: appointment.starts_at,
        ends_at: appointment.ends_at,
        location: appointment.location,
        is_all_day: appointment.is_all_day ?? false,
        travel_minutes: metadata?.travel_minutes ?? null,
        preparation_minutes: metadata?.preparation_minutes ?? null,
      } satisfies PlannerScheduleEvent,
    ];
  });
  const travelPreferences = travelIntelligence.normalizeTravelPreferences(
    notificationResult.data ?? notificationsServer.DEFAULT_PREFS,
  );
  return tasksServer.buildPlannerBusyIntervals(schedule, travelPreferences, defaultDurationMin);
}

export const previewDayReplan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => contextSchema.parse(input))
  .handler(async ({ data, context }): Promise<ReplanPreview> => {
    const { prefsForDate } = await import("./tasks.server");
    const { signPreview } = await import("./plan-preview.server");
    const bounds = dayBounds(data.date, data.timezoneOffsetMinutes);
    const [prefs, appointmentsResult, tasksResult] = await Promise.all([
      prefsForDate(context.supabase, context.userId, data.date),
      context.supabase
        .from("appointments")
        .select("id,title,starts_at,ends_at,source,updated_at")
        .eq("user_id", context.userId)
        .eq("is_all_day", false)
        .gte("starts_at", new Date(bounds.start).toISOString())
        .lt("starts_at", new Date(bounds.end).toISOString())
        .order("starts_at"),
      context.supabase
        .from("tasks")
        .select(
          "id,title,notes,estimated_min,priority,energy,deadline,status,scheduled_appointment_id,created_at",
        )
        .eq("user_id", context.userId)
        .eq("status", "scheduled")
        .not("scheduled_appointment_id", "is", null),
    ]);

    if (appointmentsResult.error) throw appointmentsResult.error;
    if (tasksResult.error) throw tasksResult.error;
    const protectedBusy = await loadProtectedSchedule(
      context.supabase,
      context.userId,
      data.date,
      data.timezoneOffsetMinutes,
      prefs.default_meeting_min,
    );

    // Reading only: this step never writes to the schedule or to history.
    const preview = buildDayReplan({
      date: data.date,
      previewId: randomUUID(),
      nowMs: Date.now(),
      timezoneOffsetMinutes: data.timezoneOffsetMinutes,
      prefs,
      tasks: (tasksResult.data ?? []) as TaskRow[],
      appointments: (appointmentsResult.data ?? []) as ReplanAppointment[],
      protectedBusy,
    });
    preview.signature = signPreview(
      preview.previewId,
      preview.date,
      preview.generatedAt,
      preview.moves as SignedMove[],
    );
    return preview;
  });

const moveSchema = z.object({
  appointmentId: z.string().uuid(),
  taskId: z.string().uuid(),
  title: z.string().min(1).max(200),
  version: z.string().datetime({ offset: true }),
  fromStart: z.string().datetime({ offset: true }),
  fromEnd: z.string().datetime({ offset: true }),
  toStart: z.string().datetime({ offset: true }),
  toEnd: z.string().datetime({ offset: true }),
  reason: z.enum(["missed", "conflict"]),
  conflictsWith: z.string().max(200).nullable(),
});

/**
 * The approval carries back the whole signed proposal plus the blocks the
 * person ticked. Nothing here is trusted on its own: the signature proves the
 * proposal is ours and unaltered, and the database revalidates every row again
 * inside the transaction that moves it.
 */
const applySchema = contextSchema.extend({
  previewId: z.string().uuid(),
  signature: z.string().min(1).max(200),
  generatedAt: z.string().datetime({ offset: true }),
  moves: z.array(moveSchema).min(1).max(20),
  approvedIds: z.array(z.string().uuid()).min(1).max(20),
});

export type ApplyReplanResult = {
  moved: number;
  planRunId: string | null;
  /** True when this exact approval had already been carried out. */
  repeated: boolean;
};

export const applyDayReplan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => applySchema.parse(input))
  .handler(async ({ data, context }): Promise<ApplyReplanResult> => {
    const { verifyPreview } = await import("./plan-preview.server");
    const moves = data.moves as SignedMove[];
    if (previewIsExpired(data.generatedAt, Date.now())) throw new PreviewExpiredError();
    if (!verifyPreview(data.previewId, data.date, data.generatedAt, moves, data.signature)) {
      throw new Error("That proposal could not be verified. Check your day again.");
    }
    const approved = selectApprovedMoves(moves, data.approvedIds);

    const { data: result, error } = await context.supabase.rpc("apply_day_replan", {
      p_preview_id: data.previewId,
      p_plan_date: data.date,
      p_moves: approved as unknown as Json,
    });
    if (error) throw new Error(error.message || "Nothing was changed. Please check your day again.");
    const payload = (result ?? {}) as { moved?: number; planRunId?: string; repeated?: boolean };
    return {
      moved: typeof payload.moved === "number" ? payload.moved : 0,
      planRunId: payload.planRunId ?? null,
      repeated: payload.repeated === true,
    };
  });


const HISTORY_LIMIT = 20;

async function loadRun(
  supabase: SupabaseClient<Database>,
  userId: string,
  planRunId: string,
) {
  const { data, error } = await supabase
    .from("plan_runs")
    .select("id,plan_date,applied_at,undone_at,summary,changes")
    .eq("user_id", userId)
    .eq("id", planRunId)
    .maybeSingle();
  if (error) throw new Error("That plan could not be loaded. Please try again.");
  if (!data) throw new Error("That plan is no longer in your history.");
  return data;
}

async function buildUndoLines(
  supabase: SupabaseClient<Database>,
  userId: string,
  changes: PlanChange[],
): Promise<UndoLine[]> {
  if (changes.length === 0) return [];
  const { data, error } = await supabase
    .from("appointments")
    .select("id,starts_at,ends_at")
    .eq("user_id", userId)
    .eq("source", "task")
    .in(
      "id",
      changes.map((change) => change.appointmentId),
    );
  if (error) throw new Error("Your schedule could not be rechecked. Please try again.");
  const byId = new Map((data ?? []).map((row) => [row.id, row]));
  return changes.map((change) => classifyUndo(change, byId.get(change.appointmentId) ?? null));
}

export const listPlanRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlanRunSummary[]> => {
    const { data, error } = await context.supabase
      .from("plan_runs")
      .select("id,plan_date,applied_at,undone_at,summary,changes")
      .eq("user_id", context.userId)
      .gte("applied_at", retentionCutoffISO(Date.now()))
      .order("applied_at", { ascending: false })
      .limit(HISTORY_LIMIT);
    if (error) throw new Error("Your plan history could not be loaded. Please try again.");
    return (data ?? []).map((row) => ({
      id: row.id,
      planDate: row.plan_date,
      appliedAt: row.applied_at,
      undoneAt: row.undone_at,
      summary: row.summary,
      changes: parsePlanChanges(row.changes),
    }));
  });

const planRunSchema = z.object({ planRunId: z.string().uuid() });

export const previewPlanUndo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => planRunSchema.parse(input))
  .handler(async ({ data, context }) => {
    const run = await loadRun(context.supabase, context.userId, data.planRunId);
    const changes = parsePlanChanges(run.changes);
    const lines = await buildUndoLines(context.supabase, context.userId, changes);
    return {
      planRunId: run.id,
      planDate: run.plan_date,
      appliedAt: run.applied_at,
      undoneAt: run.undone_at,
      lines,
      counts: summarizeUndo(lines),
    };
  });

export type UndoResult = {
  restored: number;
  skipped: number;
  counts: { restore: number; alreadyRestored: number; changedSince: number; missing: number };
  /** True when this plan had already been undone. */
  repeated: boolean;
  note: string;
};

export const undoPlanRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => planRunSchema.parse(input))
  .handler(async ({ data, context }): Promise<UndoResult> => {
    // Restoring every block and closing the history entry happens in one
    // database step, so an undo can never be left half done.
    const { data: result, error } = await context.supabase.rpc("undo_plan_run", {
      p_run_id: data.planRunId,
    });
    if (error) throw new Error(error.message || "That plan could not be undone. Please try again.");
    const payload = (result ?? {}) as {
      restored?: number;
      alreadyRestored?: number;
      changedSince?: number;
      missing?: number;
      repeated?: boolean;
      note?: string | null;
    };
    const counts = {
      restore: payload.restored ?? 0,
      alreadyRestored: payload.alreadyRestored ?? 0,
      changedSince: payload.changedSince ?? 0,
      missing: payload.missing ?? 0,
    };
    return {
      restored: counts.restore,
      skipped: counts.changedSince + counts.missing,
      counts,
      repeated: payload.repeated === true,
      note: payload.note ?? "",
    };
  });


export const deletePlanRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => planRunSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("plan_runs")
      .delete()
      .eq("user_id", context.userId)
      .eq("id", data.planRunId);
    if (error) throw new Error("That history entry could not be removed. Please try again.");
    return { ok: true };
  });
