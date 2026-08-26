import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { TaskRow, Placement, PlanExplanation } from "./tasks.server";

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
});


export const autoScheduleTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => autoSchema.parse(i))
  .handler(async ({ data, context }): Promise<AutoScheduleResult> => {
    const { prefsForDate, computeGaps, fitTasks } = await import("./tasks.server");
    const prefs = await prefsForDate(context.supabase, context.userId, data.date);

    const dayStart = new Date(`${data.date}T00:00:00`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
    const { data: appts } = await context.supabase
      .from("appointments")
      .select("starts_at,ends_at")
      .eq("user_id", context.userId)
      .gte("starts_at", dayStart.toISOString())
      .lt("starts_at", dayEnd.toISOString());

    const busy = (appts ?? [])
      .map((a: any) => {
        const s = Date.parse(a.starts_at);
        return { start: s, end: a.ends_at ? Date.parse(a.ends_at) : s + 30 * 60000 };
      })
      // All-day/multi-day entries (birthdays, holidays) are markers, not busy time.
      .filter((b: { start: number; end: number }) => b.end - b.start < 20 * 3600 * 1000);


    let taskQuery = context.supabase
      .from("tasks")
      .select(TASK_COLS)
      .eq("user_id", context.userId)
      .eq("status", "open");
    if (data.taskIds && data.taskIds.length > 0) {
      taskQuery = taskQuery.in("id", data.taskIds);
    }
    const { data: openTasks } = await taskQuery;

    const gaps = computeGaps(data.date, prefs, busy, Date.now());
    console.log("DBG plan", data.date, JSON.stringify(prefs), JSON.stringify(busy), JSON.stringify(gaps), new Date().toString());
    const { placements, unplaced, explain } = fitTasks((openTasks ?? []) as TaskRow[], gaps, prefs);


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
            notes: "Auto-scheduled from your task backlog",
          })
          .select("id")
          .single();
        if (error) throw error;
        await context.supabase
          .from("tasks")
          .update({ status: "scheduled", scheduled_appointment_id: inserted.id })
          .eq("id", p.task_id)
          .eq("user_id", context.userId);
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
    const key = process.env['LOVABLE_API_KEY'];
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
      bullets: (Array.isArray(out.bullets) ? out.bullets : []).slice(0, 5).map((b: unknown) => String(b).slice(0, 200)),
      focus: out.focus ? String(out.focus).slice(0, 200) : null,
    };
  });
