import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildDayReplan,
  intervalsOverlap,
  localTimeMs,
  type ReplanAppointment,
  type ReplanMove,
  type ReplanPreview,
} from "./replan-day";
import type { TaskRow } from "./tasks.server";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const contextSchema = z.object({
  date: dateSchema,
  timezoneOffsetMinutes: z.number().int().min(-900).max(900),
});

function dayBounds(date: string, timezoneOffsetMinutes: number) {
  const start = localTimeMs(date, "00:00", timezoneOffsetMinutes);
  return { start, end: start + 24 * 60 * 60 * 1000 };
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

    return buildDayReplan({
      date: data.date,
      nowMs: Date.now(),
      timezoneOffsetMinutes: data.timezoneOffsetMinutes,
      prefs,
      tasks: (tasksResult.data ?? []) as TaskRow[],
      appointments: (appointmentsResult.data ?? []) as ReplanAppointment[],
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

    const bounds = dayBounds(data.date, data.timezoneOffsetMinutes);
    const [prefs, targetsResult, tasksResult, dayResult] = await Promise.all([
      prefsForDate(context.supabase, context.userId, data.date),
      context.supabase
        .from("appointments")
        .select("id,title,starts_at,ends_at,source")
        .eq("user_id", context.userId)
        .in("id", ids),
      context.supabase
        .from("tasks")
        .select("id,scheduled_appointment_id")
        .eq("user_id", context.userId)
        .in("scheduled_appointment_id", ids),
      context.supabase
        .from("appointments")
        .select("id,starts_at,ends_at,is_all_day")
        .eq("user_id", context.userId)
        .gte("starts_at", new Date(bounds.start).toISOString())
        .lt("starts_at", new Date(bounds.end).toISOString()),
    ]);

    if (targetsResult.error || tasksResult.error || dayResult.error) {
      throw new Error("Your schedule could not be rechecked. Please try again.");
    }
    const targetById = new Map((targetsResult.data ?? []).map((row) => [row.id, row]));
    const linkedTaskByAppointment = new Map(
      (tasksResult.data ?? []).map((task) => [task.scheduled_appointment_id, task.id]),
    );
    const workStart = localTimeMs(data.date, prefs.work_start, data.timezoneOffsetMinutes);
    const workEnd = localTimeMs(data.date, prefs.work_end, data.timezoneOffsetMinutes);
    const lunchStart = localTimeMs(data.date, prefs.lunch_at, data.timezoneOffsetMinutes);
    const lunchEnd = lunchStart + prefs.lunch_length_min * 60_000;
    const movingIds = new Set(ids);
    const occupied = (dayResult.data ?? [])
      .filter((row) => !movingIds.has(row.id) && !row.is_all_day)
      .map((row) => {
        const start = Date.parse(row.starts_at);
        return { start, end: row.ends_at ? Date.parse(row.ends_at) : start + 30 * 60_000 };
      });
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
        proposals.some((block) => intervalsOverlap(proposal, block))
      ) {
        throw new Error("A new conflict appeared. Refresh the proposal before applying it.");
      }
      proposals.push(proposal);
    }

    const updates = await Promise.all(
      proposals.map(({ move }) =>
        context.supabase
          .from("appointments")
          .update({ starts_at: move.toStart, ends_at: move.toEnd, commitment_type: "flexible" })
          .eq("id", move.appointmentId)
          .eq("user_id", context.userId)
          .eq("source", "task")
          .eq("starts_at", move.fromStart)
          .eq("ends_at", move.fromEnd)
          .select("id")
          .maybeSingle(),
      ),
    );
    if (updates.some((result) => result.error || !result.data)) {
      throw new Error("One or more task blocks changed. Refresh your day and try again.");
    }
    return { moved: updates.length };
  });
