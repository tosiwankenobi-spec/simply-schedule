import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { TaskRow, Placement, PlanExplanation, PlannerScheduleEvent } from "./tasks.server";

const TASK_COLS =
  "id,title,notes,estimated_min,priority,energy,deadline,status,scheduled_appointment_id,created_at";

export const listTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TaskRow[]> => {
    const { data, error } = await context.supabase
      .from("tasks")
      .select(TASK_COLS)
      .eq("user_id", context.userId)
      .order("status")
      .order("priority")
      .order("created_at");
    if (error) throw error;
    return (data ?? []) as TaskRow[];
  });

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  notes: z.string().max(1000).nullable().optional(),
  estimated_min: z.number().int().min(10).max(480).default(30),
  priority: z.number().int().min(1).max(3).default(2),
  energy: z.enum(["deep", "light", "any"]).default("any"),
  deadline: z.string().nullable().optional(),
});

export const upsertTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => upsertSchema.parse(i))
  .handler(async ({ data, context }) => {
    const row = {
      user_id: context.userId,
      title: data.title,
      notes: data.notes ?? null,
      estimated_min: data.estimated_min,
      priority: data.priority,
      energy: data.energy,
      deadline: data.deadline || null,
    };
    if (data.id) {
      const { error } = await context.supabase
        .from("tasks")
        .update(row)
        .eq("id", data.id)
        .eq("user_id", context.userId);
      if (error) throw error;
      return { ok: true };
    }
    const { error } = await context.supabase.from("tasks").insert(row);
    if (error) throw error;
    return { ok: true };
  });

export const setTaskStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ id: z.string().uuid(), status: z.enum(["open", "scheduled", "done"]) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("tasks")
      .update({ status: data.status })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

export const deleteTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("tasks")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

export type AutoScheduleResult = {
  date: string;
  profile: string;
  placements: Placement[];
  unplaced: { id: string; title: string; estimated_min: number }[];
  explain: PlanExplanation;
  applied: boolean;
};

const autoSchema = z.object({
  date: z.string(),
  dryRun: z.boolean().default(true),
  taskIds: z.array(z.string().uuid()).optional(),
  /** Browser Date#getTimezoneOffset(): minutes UTC is ahead of the user's local time. */
  tzOffsetMin: z.number().int().min(-900).max(900).default(0),
});

export const autoScheduleTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => autoSchema.parse(i))
  .handler(async ({ data, context }): Promise<AutoScheduleResult> => {
    const [
      { prefsForDate, computeGaps, fitTasks, localDayBounds, buildPlannerBusyIntervals },
      { DEFAULT_PREFS, NOTIF_COLS },
      { normalizeTravelPreferences },
    ] = await Promise.all([
      import("./tasks.server"),
      import("./notifications.server"),
      import("./travel-intelligence"),
    ]);
    const bounds = localDayBounds(data.date, data.tzOffsetMin);
    let taskQuery = context.supabase
      .from("tasks")
      .select(TASK_COLS)
      .eq("user_id", context.userId)
      .eq("status", "open");
    if (data.taskIds && data.taskIds.length > 0) {
      taskQuery = taskQuery.in("id", data.taskIds);
    }

    const [prefs, scheduleResult, ownMetadataResult, tasksResult, notificationResult] =
      await Promise.all([
        prefsForDate(context.supabase, context.userId, data.date),
        context.supabase
          .from("schedule_hub_events")
          .select("id,title,starts_at,ends_at,location,is_all_day")
          .gte("starts_at", bounds.start)
          .lt("starts_at", bounds.end)
          .order("starts_at"),
        context.supabase
          .from("appointments")
          .select("id,travel_minutes,preparation_minutes")
          .eq("user_id", context.userId)
          .gte("starts_at", bounds.start)
          .lt("starts_at", bounds.end),
        taskQuery,
        context.supabase
          .from("notification_prefs")
          .select(NOTIF_COLS)
          .eq("user_id", context.userId)
          .maybeSingle(),
      ]);

    if (scheduleResult.error) throw scheduleResult.error;
    if (ownMetadataResult.error) throw ownMetadataResult.error;
    if (tasksResult.error) throw tasksResult.error;
    if (notificationResult.error) throw notificationResult.error;

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
    const travelPreferences = normalizeTravelPreferences(notificationResult.data ?? DEFAULT_PREFS);
    const busy = buildPlannerBusyIntervals(schedule, travelPreferences, prefs.default_meeting_min);

    const gaps = computeGaps(data.date, prefs, busy, Date.now(), data.tzOffsetMin);
    const { placements, unplaced, explain } = fitTasks(
      (tasksResult.data ?? []) as TaskRow[],
      gaps,
      prefs,
    );
    const protectedTrips = busy.filter((interval) => interval.travelProtected).length;
    explain.rules.splice(
      2,
      0,
      protectedTrips > 0
        ? `${protectedTrips} physical appointment${protectedTrips === 1 ? "" : "s"} reserved travel, safety buffer and preparation time.`
        : "No physical appointment needed an additional travel window.",
    );

    if (!data.dryRun && placements.length > 0) {
      for (const p of placements) {
        const { data: inserted, error } = await context.supabase
          .from("appointments")
          .insert({
            user_id: context.userId,
            title: p.title,
            starts_at: p.starts_at,
            ends_at: p.ends_at,
            source: "task",
            commitment_type: "flexible",
            notes: "Auto-scheduled from your task backlog",
            source_metadata: { planner_task_id: p.task_id, planner: "daily" },
          })
          .select("id")
          .single();
        if (error) throw error;
        const { data: updatedTask, error: taskError } = await context.supabase
          .from("tasks")
          .update({ status: "scheduled", scheduled_appointment_id: inserted.id })
          .eq("id", p.task_id)
          .eq("user_id", context.userId)
          .eq("status", "open")
          .select("id")
          .maybeSingle();
        if (taskError || !updatedTask) {
          const { error: rollbackError } = await context.supabase
            .from("appointments")
            .delete()
            .eq("id", inserted.id)
            .eq("user_id", context.userId);
          if (rollbackError) throw rollbackError;
          throw taskError ?? new Error("That task was scheduled somewhere else. Refresh the plan.");
        }
      }
    }

    return {
      date: data.date,
      profile: prefs.name,
      placements,
      unplaced: unplaced.map((t) => ({ id: t.id, title: t.title, estimated_min: t.estimated_min })),
      explain,
      applied: !data.dryRun,
    };
  });

export type Briefing = { headline: string; bullets: string[]; focus: string | null };

export const dailyBriefing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ date: z.string() }).parse(i))
  .handler(async ({ data, context }): Promise<Briefing> => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const { prefsForDate, callAIJson, rankTasks } = await import("./tasks.server");
    const prefs = await prefsForDate(context.supabase, context.userId, data.date);

    const dayStart = new Date(`${data.date}T00:00:00`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
    const { data: appts } = await context.supabase
      .from("appointments")
      .select("title,starts_at,ends_at,location")
      .eq("user_id", context.userId)
      .gte("starts_at", dayStart.toISOString())
      .lt("starts_at", dayEnd.toISOString())
      .order("starts_at");

    const { data: tasks } = await context.supabase
      .from("tasks")
      .select(TASK_COLS)
      .eq("user_id", context.userId)
      .neq("status", "done");

    const top = rankTasks((tasks ?? []) as TaskRow[]).slice(0, 6);

    const system = `You are a calm, concise scheduling assistant writing a morning briefing for ${data.date}.
Working hours ${prefs.work_start}–${prefs.work_end} (profile: ${prefs.name}).
Be specific and practical: mention real times, flag tight gaps or back-to-back meetings, and name the single most important thing to protect time for.
Keep each bullet under 140 characters. 3–5 bullets.
Return JSON: {"headline": string, "bullets": string[], "focus": string|null}`;

    const user = JSON.stringify({
      appointments: appts ?? [],
      open_tasks: top.map((t) => ({
        title: t.title,
        estimated_min: t.estimated_min,
        priority: t.priority,
        deadline: t.deadline,
      })),
    });

    const out = await callAIJson(system, user, key);
    return {
      headline: String(out.headline ?? "Today at a glance").slice(0, 160),
      bullets: (Array.isArray(out.bullets) ? out.bullets : [])
        .slice(0, 5)
        .map((b: unknown) => String(b).slice(0, 200)),
      focus: out.focus ? String(out.focus).slice(0, 200) : null,
    };
  });
