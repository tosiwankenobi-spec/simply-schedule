import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  buildDayReplan,
  intervalsOverlap,
  localTimeMs,
  type ReplanAppointment,
  type ReplanMove,
  type ReplanPreview,
} from "./replan-day";
import type { PlannerScheduleEvent, TaskRow } from "./tasks.server";

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
    const bounds = dayBounds(data.date, data.timezoneOffsetMinutes);
    const [prefs, appointmentsResult, tasksResult] = await Promise.all([
      prefsForDate(context.supabase, context.userId, data.date),
      context.supabase
        .from("appointments")
        .select("id,title,starts_at,ends_at,source")
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

    return buildDayReplan({
      date: data.date,
      nowMs: Date.now(),
      timezoneOffsetMinutes: data.timezoneOffsetMinutes,
      prefs,
      tasks: (tasksResult.data ?? []) as TaskRow[],
      appointments: (appointmentsResult.data ?? []) as ReplanAppointment[],
      protectedBusy,
    });
  });

const moveSchema = z.object({
  appointmentId: z.string().uuid(),
  taskId: z.string().uuid(),
  title: z.string().min(1).max(200),
  fromStart: z.string().datetime(),
  fromEnd: z.string().datetime(),
  toStart: z.string().datetime(),
  toEnd: z.string().datetime(),
  reason: z.enum(["missed", "conflict"]),
  conflictsWith: z.string().max(200).nullable(),
});
const applySchema = contextSchema.extend({ moves: z.array(moveSchema).min(1).max(20) });

export const applyDayReplan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => applySchema.parse(input))
  .handler(async ({ data, context }): Promise<{ moved: number }> => {
    const { prefsForDate } = await import("./tasks.server");
    const ids = data.moves.map((move) => move.appointmentId);
    if (new Set(ids).size !== ids.length) throw new Error("Duplicate task blocks are not allowed.");

    const [prefs, targetsResult, tasksResult] = await Promise.all([
      prefsForDate(context.supabase, context.userId, data.date),
      context.supabase
        .from("appointments")
        .select("id,title,starts_at,ends_at,source,commitment_type")
        .eq("user_id", context.userId)
        .in("id", ids),
      context.supabase
        .from("tasks")
        .select("id,scheduled_appointment_id")
        .eq("user_id", context.userId)
        .in("scheduled_appointment_id", ids),
    ]);

    if (targetsResult.error || tasksResult.error) {
      throw new Error("Your schedule could not be rechecked. Please try again.");
    }
    const protectedSchedule = await loadProtectedSchedule(
      context.supabase,
      context.userId,
      data.date,
      data.timezoneOffsetMinutes,
      prefs.default_meeting_min,
    );
    const targetById = new Map((targetsResult.data ?? []).map((row) => [row.id, row]));
    const linkedTaskByAppointment = new Map(
      (tasksResult.data ?? []).map((task) => [task.scheduled_appointment_id, task.id]),
    );
    const workStart = localTimeMs(data.date, prefs.work_start, data.timezoneOffsetMinutes);
    const workEnd = localTimeMs(data.date, prefs.work_end, data.timezoneOffsetMinutes);
    const lunchStart = localTimeMs(data.date, prefs.lunch_at, data.timezoneOffsetMinutes);
    const lunchEnd = lunchStart + prefs.lunch_length_min * 60_000;
    const movingIds = new Set(ids);
    const occupied = protectedSchedule.filter((row) => !movingIds.has(row.id));
    const proposals: { move: ReplanMove; start: number; end: number }[] = [];

    for (const move of data.moves) {
      const target = targetById.get(move.appointmentId);
      if (
        !target ||
        target.source !== "task" ||
        linkedTaskByAppointment.get(move.appointmentId) !== move.taskId ||
        Date.parse(target.starts_at) !== Date.parse(move.fromStart) ||
        !target.ends_at ||
        Date.parse(target.ends_at) !== Date.parse(move.fromEnd)
      ) {
        throw new Error("Your schedule changed. Refresh the proposal before applying it.");
      }
      const fromDuration = Date.parse(move.fromEnd) - Date.parse(move.fromStart);
      const start = Date.parse(move.toStart);
      const end = Date.parse(move.toEnd);
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end <= start ||
        end - start !== fromDuration ||
        start < Math.max(Date.now() - 60_000, workStart) ||
        end > workEnd ||
        (prefs.lunch_length_min > 0 &&
          intervalsOverlap({ start, end }, { start: lunchStart, end: lunchEnd }))
      ) {
        throw new Error("That proposal is no longer a safe fit for today.");
      }
      const proposal = { move: move as ReplanMove, start, end };
      if (
        occupied.some((block) => intervalsOverlap(proposal, block)) ||
        proposals.some((block) =>
          intervalsOverlap(proposal, {
            start: block.start,
            end: block.end + prefs.break_length_min * 60_000,
          }),
        )
      ) {
        throw new Error("A new conflict appeared. Refresh the proposal before applying it.");
      }
      proposals.push(proposal);
    }

    const applied: typeof proposals = [];
    for (const proposal of proposals) {
      const { move } = proposal;
      const updateResult = await context.supabase
        .from("appointments")
        .update({ starts_at: move.toStart, ends_at: move.toEnd, commitment_type: "flexible" })
        .eq("id", move.appointmentId)
        .eq("user_id", context.userId)
        .eq("source", "task")
        .eq("starts_at", move.fromStart)
        .eq("ends_at", move.fromEnd)
        .select("id")
        .maybeSingle();
      if (!updateResult.error && updateResult.data) {
        applied.push(proposal);
        continue;
      }

      let rollbackFailed = false;
      const rollbackCandidates = [proposal, ...[...applied].reverse()];
      for (const completed of rollbackCandidates) {
        const original = targetById.get(completed.move.appointmentId);
        const rollbackResult = await context.supabase
          .from("appointments")
          .update({
            starts_at: completed.move.fromStart,
            ends_at: completed.move.fromEnd,
            commitment_type: original ? original.commitment_type : "flexible",
          })
          .eq("id", completed.move.appointmentId)
          .eq("user_id", context.userId)
          .eq("source", "task")
          .eq("starts_at", completed.move.toStart)
          .eq("ends_at", completed.move.toEnd)
          .select("id")
          .maybeSingle();
        const wasConfirmedApplied = applied.some(
          ({ move: appliedMove }) => appliedMove.appointmentId === completed.move.appointmentId,
        );
        rollbackFailed ||=
          Boolean(rollbackResult.error) || (wasConfirmedApplied && !rollbackResult.data);
      }
      if (rollbackFailed) {
        throw new Error(
          "Replanning stopped, but an earlier move could not be restored. Review today's task blocks before trying again.",
        );
      }
      throw new Error(
        "One or more task blocks changed. No moves were saved; refresh and try again.",
      );
    }
    return { moved: applied.length };
  });
