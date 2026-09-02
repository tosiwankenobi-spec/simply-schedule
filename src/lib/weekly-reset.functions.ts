import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  addDateDays,
  buildWeeklyReview,
  overlaps,
  wallClockMs,
  type WeeklyResetAppointment,
  type WeeklyResetTask,
  type ReviewTask,
} from "./weekly-reset";
import type { Placement } from "./tasks.server";

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    try {
      return addDateDays(value, 0) === value;
    } catch {
      return false;
    }
  }, "Invalid calendar date");
const previewSchema = z.object({
  weekStart: dateSchema,
  tzOffsetMin: z.number().int().min(-900).max(900).default(0),
});

export type WeeklyProposal = Placement & {
  task_updated_at: string;
  deadline: string | null;
  priority: number;
};

export type WeeklyResetPreview = {
  weekStart: string;
  weekEnd: string;
  reviewStart: string;
  completed: ReviewTask[];
  slipped: ReviewTask[];
  commitments: Pick<
    WeeklyResetAppointment,
    "id" | "title" | "starts_at" | "ends_at" | "location"
  >[];
  proposals: WeeklyProposal[];
  unplaced: { id: string; title: string; estimated_min: number }[];
};

export const previewWeeklyReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => previewSchema.parse(input))
  .handler(async ({ data, context }): Promise<WeeklyResetPreview> => {
    const { prefsForDate, computeGaps, fitTasks, rankTasks } = await import("./tasks.server");
    const reviewStart = addDateDays(data.weekStart, -7);
    const weekEnd = addDateDays(data.weekStart, 7);
    const reviewStartMs = wallClockMs(reviewStart, "00:00", data.tzOffsetMin);
    const weekStartMs = wallClockMs(data.weekStart, "00:00", data.tzOffsetMin);
    const weekEndMs = wallClockMs(weekEnd, "00:00", data.tzOffsetMin);
    const nowMs = Date.now();

    const [
      { data: taskRows, error: taskError },
      { data: appointmentRows, error: appointmentError },
    ] = await Promise.all([
      context.supabase
        .from("tasks")
        .select(
          "id,title,notes,estimated_min,priority,energy,deadline,status,scheduled_appointment_id,created_at,updated_at",
        )
        .eq("user_id", context.userId)
        .order("priority")
        .order("deadline")
        .limit(500),
      context.supabase
        .from("appointments")
        .select("id,title,starts_at,ends_at,location,source,commitment_type,is_all_day")
        .eq("user_id", context.userId)
        .gte("starts_at", new Date(reviewStartMs).toISOString())
        .lt("starts_at", new Date(weekEndMs).toISOString())
        .order("starts_at")
        .limit(500),
    ]);
    if (taskError) throw taskError;
    if (appointmentError) throw appointmentError;

    const tasks = (taskRows ?? []) as WeeklyResetTask[];
    const appointments = (appointmentRows ?? []) as WeeklyResetAppointment[];
    const review = buildWeeklyReview({ tasks, appointments, reviewStartMs, weekStartMs, nowMs });
    let remaining = rankTasks(review.eligible) as WeeklyResetTask[];
    const proposals: WeeklyProposal[] = [];

    for (let dayOffset = 0; dayOffset < 7 && remaining.length > 0; dayOffset++) {
      const date = addDateDays(data.weekStart, dayOffset);
      const dayStart = wallClockMs(date, "00:00", data.tzOffsetMin);
      const dayEnd = wallClockMs(addDateDays(date, 1), "00:00", data.tzOffsetMin);
      const prefs = await prefsForDate(context.supabase, context.userId, date);
      const busy = appointments
        .filter((appointment) => {
          const start = Date.parse(appointment.starts_at);
          return !appointment.is_all_day && start >= dayStart && start < dayEnd;
        })
        .map((appointment) => {
          const start = Date.parse(appointment.starts_at);
          const explicitEnd = appointment.ends_at ? Date.parse(appointment.ends_at) : Number.NaN;
          return { start, end: Number.isFinite(explicitEnd) ? explicitEnd : start + 30 * 60000 };
        });
      const gaps = computeGaps(date, prefs, busy, nowMs, data.tzOffsetMin);
      const dayPlan = fitTasks(remaining, gaps, prefs);
      const dayPlacements = dayPlan.placements.slice(0, 3);
      const placedIds = new Set(dayPlacements.map((placement) => placement.task_id));
      for (const placement of dayPlacements) {
        const task = remaining.find((candidate) => candidate.id === placement.task_id)!;
        proposals.push({
          ...placement,
          task_updated_at: task.updated_at,
          deadline: task.deadline,
          priority: task.priority,
        });
      }
      remaining = remaining.filter((task) => !placedIds.has(task.id));
    }

    const commitments = appointments
      .filter((appointment) => {
        const start = Date.parse(appointment.starts_at);
        return start >= weekStartMs && start < weekEndMs && appointment.source !== "task";
      })
      .slice(0, 20)
      .map(({ id, title, starts_at, ends_at, location }) => ({
        id,
        title,
        starts_at,
        ends_at,
        location,
      }));

    return {
      weekStart: data.weekStart,
      weekEnd,
      reviewStart,
      completed: review.completed,
      slipped: review.slipped,
      commitments,
      proposals,
      unplaced: remaining.map((task) => ({
        id: task.id,
        title: task.title,
        estimated_min: task.estimated_min,
      })),
    };
  });

const applySchema = z.object({
  weekStart: dateSchema,
  tzOffsetMin: z.number().int().min(-900).max(900).default(0),
  items: z
    .array(
      z
        .object({
          task_id: z.string().uuid(),
          starts_at: z.string().refine((value) => Number.isFinite(Date.parse(value))),
          ends_at: z.string().refine((value) => Number.isFinite(Date.parse(value))),
          task_updated_at: z.string().refine((value) => Number.isFinite(Date.parse(value))),
        })
        .refine((item) => Date.parse(item.ends_at) > Date.parse(item.starts_at), {
          message: "End time must be after start time.",
        }),
    )
    .min(1)
    .max(21),
});

export const applyWeeklyReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => applySchema.parse(input))
  .handler(async ({ data, context }) => {
    const weekEnd = addDateDays(data.weekStart, 7);
    const weekStartMs = wallClockMs(data.weekStart, "00:00", data.tzOffsetMin);
    const weekEndMs = wallClockMs(weekEnd, "00:00", data.tzOffsetMin);
    const taskIds = [...new Set(data.items.map((item) => item.task_id))];
    const [{ data: tasks, error: taskError }, { data: appointments, error: appointmentError }] =
      await Promise.all([
        context.supabase
          .from("tasks")
          .select("id,title,notes,status,updated_at")
          .eq("user_id", context.userId)
          .in("id", taskIds),
        context.supabase
          .from("appointments")
          .select("id,title,starts_at,ends_at,is_all_day")
          .eq("user_id", context.userId)
          .gte("starts_at", new Date(weekStartMs).toISOString())
          .lt("starts_at", new Date(weekEndMs).toISOString())
          .order("starts_at")
          .limit(500),
      ]);
    if (taskError) throw taskError;
    if (appointmentError) throw appointmentError;

    const taskById = new Map((tasks ?? []).map((task) => [task.id, task]));
    const occupied = (appointments ?? []).filter((appointment) => !appointment.is_all_day);
    const added: string[] = [];
    const skipped: { title: string; reason: string }[] = [];

    for (const item of [...data.items].sort(
      (left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at),
    )) {
      const task = taskById.get(item.task_id);
      if (!task || task.status === "done") {
        skipped.push({ title: task?.title ?? "Task", reason: "Task is no longer available." });
        continue;
      }
      if (task.updated_at !== item.task_updated_at) {
        skipped.push({ title: task.title, reason: "Task changed after this preview." });
        continue;
      }
      const start = Date.parse(item.starts_at);
      const end = Date.parse(item.ends_at);
      if (
        start < weekStartMs ||
        end > weekEndMs ||
        end - start < 10 * 60000 ||
        end - start > 8 * 3600 * 1000
      ) {
        skipped.push({ title: task.title, reason: "Proposed time is outside this week." });
        continue;
      }
      const conflict = occupied.find((appointment) => overlaps(item, appointment));
      if (conflict) {
        skipped.push({ title: task.title, reason: `Now overlaps ${conflict.title}.` });
        continue;
      }

      const { data: appointment, error: insertError } = await context.supabase
        .from("appointments")
        .insert({
          user_id: context.userId,
          title: task.title,
          starts_at: item.starts_at,
          ends_at: item.ends_at,
          source: "task",
          commitment_type: "flexible",
          notes: task.notes || "Scheduled during Weekly Reset",
        })
        .select("id,title,starts_at,ends_at,is_all_day")
        .single();
      if (insertError) throw insertError;

      const { data: linked, error: updateError } = await context.supabase
        .from("tasks")
        .update({ status: "scheduled", scheduled_appointment_id: appointment.id })
        .eq("id", task.id)
        .eq("user_id", context.userId)
        .eq("updated_at", item.task_updated_at)
        .select("id")
        .maybeSingle();
      if (updateError || !linked) {
        await context.supabase
          .from("appointments")
          .delete()
          .eq("id", appointment.id)
          .eq("user_id", context.userId);
        skipped.push({
          title: task.title,
          reason: "Task changed while the plan was being applied.",
        });
        continue;
      }

      occupied.push(appointment);
      added.push(task.title);
    }

    return { added, skipped };
  });
