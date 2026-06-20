import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type PlannerPrefs = {
  work_start: string;
  work_end: string;
  default_meeting_min: number;
  break_every_min: number;
  break_length_min: number;
  lunch_at: string;
  lunch_length_min: number;
  notes: string | null;
};

export type PlannerProfile = PlannerPrefs & {
  id: string;
  name: string;
  is_default: boolean;
};

export type PlannerAssignment = {
  id: string;
  profile_id: string;
  start_date: string;
  end_date: string;
};

const DEFAULT_PREFS: PlannerPrefs = {
  work_start: "09:00",
  work_end: "18:00",
  default_meeting_min: 30,
  break_every_min: 90,
  break_length_min: 10,
  lunch_at: "12:30",
  lunch_length_min: 45,
  notes: null,
};

const PROFILE_COLS =
  "id,name,is_default,work_start,work_end,default_meeting_min,break_every_min,break_length_min,lunch_at,lunch_length_min,notes";

async function ensureDefaultProfile(supabase: any, userId: string): Promise<PlannerProfile> {
  const { data: existing } = await supabase
    .from("planner_profiles")
    .select(PROFILE_COLS)
    .eq("user_id", userId)
    .eq("is_default", true)
    .maybeSingle();
  if (existing) return existing as PlannerProfile;

  const { data: any1 } = await supabase
    .from("planner_profiles")
    .select(PROFILE_COLS)
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (any1) return any1 as PlannerProfile;

  const { data: created, error } = await supabase
    .from("planner_profiles")
    .insert({ user_id: userId, name: "Default", is_default: true, ...DEFAULT_PREFS })
    .select(PROFILE_COLS)
    .single();
  if (error) throw error;
  return created as PlannerProfile;
}

async function resolvePrefsForDate(
  supabase: any,
  userId: string,
  date?: string,
): Promise<PlannerProfile> {
  if (date) {
    const { data: assigns } = await supabase
      .from("planner_profile_assignments")
      .select("profile_id,start_date,end_date,created_at")
      .eq("user_id", userId)
      .lte("start_date", date)
      .gte("end_date", date)
      .order("created_at", { ascending: false })
      .limit(1);
    const a = (assigns ?? [])[0];
    if (a) {
      const { data: prof } = await supabase
        .from("planner_profiles")
        .select(PROFILE_COLS)
        .eq("user_id", userId)
        .eq("id", a.profile_id)
        .maybeSingle();
      if (prof) return prof as PlannerProfile;
    }
  }
  return ensureDefaultProfile(supabase, userId);
}

async function loadProfileById(
  supabase: any,
  userId: string,
  profileId?: string | null,
  date?: string,
): Promise<PlannerProfile> {
  if (profileId) {
    const { data: prof } = await supabase
      .from("planner_profiles")
      .select(PROFILE_COLS)
      .eq("user_id", userId)
      .eq("id", profileId)
      .maybeSingle();
    if (prof) return prof as PlannerProfile;
  }
  return resolvePrefsForDate(supabase, userId, date);
}

function prefsBlock(p: PlannerPrefs & { name?: string }) {
  return `User planner preferences${p.name ? ` (profile: ${p.name})` : ""} — HONOR THESE:
- Working hours: ${p.work_start}–${p.work_end}
- Default meeting/block duration: ${p.default_meeting_min} min
- Insert a short break (${p.break_length_min} min) roughly every ${p.break_every_min} min of focused work
- Lunch around ${p.lunch_at} for ${p.lunch_length_min} min${p.lunch_length_min === 0 ? " (skip)" : ""}
${p.notes ? `- Extra constraints from user: ${p.notes}` : ""}`;
}

// ============ Profile CRUD ============

export const listPlannerProfiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlannerProfile[]> => {
    await ensureDefaultProfile(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("planner_profiles")
      .select(PROFILE_COLS)
      .eq("user_id", context.userId)
      .order("is_default", { ascending: false })
      .order("name");
    if (error) throw error;
    return (data ?? []) as PlannerProfile[];
  });

const profileFields = {
  work_start: z.string().regex(/^\d{2}:\d{2}$/),
  work_end: z.string().regex(/^\d{2}:\d{2}$/),
  default_meeting_min: z.number().int().min(5).max(480),
  break_every_min: z.number().int().min(15).max(480),
  break_length_min: z.number().int().min(5).max(120),
  lunch_at: z.string().regex(/^\d{2}:\d{2}$/),
  lunch_length_min: z.number().int().min(0).max(180),
  notes: z.string().max(1000).nullable().optional(),
};

const upsertProfileSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(60),
  is_default: z.boolean().optional(),
  ...profileFields,
});

export const upsertPlannerProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => upsertProfileSchema.parse(i))
  .handler(async ({ data, context }) => {
    const row = {
      user_id: context.userId,
      name: data.name,
      is_default: data.is_default ?? false,
      work_start: data.work_start,
      work_end: data.work_end,
      default_meeting_min: data.default_meeting_min,
      break_every_min: data.break_every_min,
      break_length_min: data.break_length_min,
      lunch_at: data.lunch_at,
      lunch_length_min: data.lunch_length_min,
      notes: data.notes ?? null,
    };

    if (row.is_default) {
      await context.supabase
        .from("planner_profiles")
        .update({ is_default: false })
        .eq("user_id", context.userId)
        .neq("id", data.id ?? "00000000-0000-0000-0000-000000000000");
    }

    if (data.id) {
      const { data: updated, error } = await context.supabase
        .from("planner_profiles")
        .update(row)
        .eq("id", data.id)
        .eq("user_id", context.userId)
        .select(PROFILE_COLS)
        .single();
      if (error) throw error;
      return updated as PlannerProfile;
    }
    const { data: inserted, error } = await context.supabase
      .from("planner_profiles")
      .insert(row)
      .select(PROFILE_COLS)
      .single();
    if (error) throw error;
    return inserted as PlannerProfile;
  });

export const deletePlannerProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { count } = await context.supabase
      .from("planner_profiles")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId);
    if ((count ?? 0) <= 1) throw new Error("Can't delete your only profile.");

    const { data: target } = await context.supabase
      .from("planner_profiles")
      .select("is_default")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();

    const { error } = await context.supabase
      .from("planner_profiles")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw error;

    if (target?.is_default) {
      const { data: next } = await context.supabase
        .from("planner_profiles")
        .select("id")
        .eq("user_id", context.userId)
        .order("name")
        .limit(1)
        .maybeSingle();
      if (next) {
        await context.supabase
          .from("planner_profiles")
          .update({ is_default: true })
          .eq("id", next.id);
      }
    }
    return { ok: true };
  });

// ============ Assignments ============

export const listPlannerAssignments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlannerAssignment[]> => {
    const { data, error } = await context.supabase
      .from("planner_profile_assignments")
      .select("id,profile_id,start_date,end_date")
      .eq("user_id", context.userId)
      .order("start_date", { ascending: false });
    if (error) throw error;
    return (data ?? []) as PlannerAssignment[];
  });

const assignSchema = z.object({
  profile_id: z.string().uuid(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const addPlannerAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => assignSchema.parse(i))
  .handler(async ({ data, context }) => {
    if (data.end_date < data.start_date) throw new Error("End must be on or after start.");
    const { data: inserted, error } = await context.supabase
      .from("planner_profile_assignments")
      .insert({ user_id: context.userId, ...data })
      .select("id,profile_id,start_date,end_date")
      .single();
    if (error) throw error;
    return inserted as PlannerAssignment;
  });

export const deletePlannerAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("planner_profile_assignments")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

export const getPrefsForDate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(i))
  .handler(async ({ data, context }): Promise<PlannerProfile> => {
    return resolvePrefsForDate(context.supabase, context.userId, data.date);
  });

// Backwards-compatible: returns the default profile's prefs.
export const getPlannerPrefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlannerPrefs> => {
    const p = await ensureDefaultProfile(context.supabase, context.userId);
    return p;
  });

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

async function callAI(system: string, user: string, key: string) {
  const res = await fetch(LOVABLE_AI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });
  if (res.status === 429) throw new Error("Rate limit reached, try again shortly.");
  if (res.status === 402) throw new Error("AI credits exhausted — add credits in Settings.");
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AI request failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  let content: string = json?.choices?.[0]?.message?.content ?? "";
  content = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("AI returned malformed JSON.");
    return JSON.parse(m[0]);
  }
}

// ============ 1. Daily schedule optimizer ============

const optimizeSchema = z.object({
  date: z.string(),
  workStart: z.string().optional(),
  workEnd: z.string().optional(),
  goals: z.string().max(500).optional(),
  profileId: z.string().uuid().optional(),
});

export type DailyPlanItem = {
  time: string; // "HH:mm"
  title: string;
  kind: "appointment" | "block" | "break";
  rationale?: string;
};

export const optimizeDay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => optimizeSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ summary: string; items: DailyPlanItem[] }> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const prefs = await loadProfileById(context.supabase, context.userId, data.profileId ?? null, data.date);
    const workStart = data.workStart ?? prefs.work_start;
    const workEnd = data.workEnd ?? prefs.work_end;

    const dayStart = new Date(`${data.date}T00:00:00`);
    const dayEnd = new Date(`${data.date}T23:59:59`);
    const { data: appts, error } = await context.supabase
      .from("appointments")
      .select("title,starts_at,ends_at,location,notes")
      .gte("starts_at", dayStart.toISOString())
      .lte("starts_at", dayEnd.toISOString())
      .order("starts_at");
    if (error) throw error;

    const system = `You are a focused day planner. Build an optimized hour-by-hour plan for one day.
- Anchor existing appointments at their fixed times (do not move them).
- Around them, time-block focus work, prep, transitions, and short breaks.
- Honor working hours and the user's goals.
- Default block length should match the user's preferred meeting/block duration.
- Insert breaks and lunch as configured below.

${prefsBlock(prefs)}

Return JSON:
{"summary": string (1-2 sentences), "items": [{"time":"HH:mm","title":string,"kind":"appointment"|"block"|"break","rationale":string}]}`;

    const user = JSON.stringify({
      date: data.date,
      working_hours: `${workStart}–${workEnd}`,
      goals: data.goals ?? "general productive day",
      fixed_appointments: (appts ?? []).map((a) => ({
        title: a.title,
        starts_at: a.starts_at,
        ends_at: a.ends_at,
        location: a.location,
      })),
    });

    const out = await callAI(system, user, key);
    return {
      summary: String(out.summary ?? "").slice(0, 400),
      items: Array.isArray(out.items) ? out.items.slice(0, 30) : [],
    };
  });

// ============ 2. Natural language → appointment ============

const taskSchema = z.object({
  text: z.string().min(1).max(1000),
  now: z.string().optional(),
});

export const planTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => taskSchema.parse(i))
  .handler(async ({ data, context }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const prefs = await ensureDefaultProfile(context.supabase, context.userId);
    const now = data.now ?? new Date().toISOString();
    const tzOffsetMin = new Date().getTimezoneOffset();

    const system = `Turn the user's request into ONE scheduled appointment.
Now: ${now}. User timezone offset: ${-tzOffsetMin} min from UTC.
Resolve relative phrases ("tomorrow morning", "Friday afternoon", "in 2 hours") against now.
Defaults: morning=${prefs.work_start}, afternoon=14:00, evening=19:00. Default duration ${prefs.default_meeting_min} min unless stated.
Stay within working hours ${prefs.work_start}–${prefs.work_end} unless the user specifies otherwise.
Return JSON: {"title":string,"starts_at":ISO8601 with offset,"ends_at":ISO8601 or null,"location":string|null,"notes":string|null}`;

    const out = await callAI(system, data.text, key);
    if (!out.title || !out.starts_at || Number.isNaN(Date.parse(out.starts_at))) {
      throw new Error("Couldn't schedule that — try adding a time.");
    }

    const { data: inserted, error } = await context.supabase
      .from("appointments")
      .insert({
        user_id: context.userId,
        title: String(out.title).slice(0, 200),
        starts_at: out.starts_at,
        ends_at: out.ends_at && !Number.isNaN(Date.parse(out.ends_at)) ? out.ends_at : null,
        location: out.location ? String(out.location).slice(0, 200) : null,
        notes: out.notes ? String(out.notes).slice(0, 1000) : null,
        source: "ai",
      })
      .select()
      .single();
    if (error) throw error;
    return inserted;
  });

// ============ 3. Weekly goal planner ============

const weekSchema = z.object({
  goals: z.string().min(1).max(2000),
  startDate: z.string(),
  days: z.number().int().min(1).max(14).default(7),
  workStart: z.string().optional(),
  workEnd: z.string().optional(),
  profileId: z.string().uuid().optional(),
});

export const planWeek = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => weekSchema.parse(i))
  .handler(async ({ data, context }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const prefs = await loadPrefs(context.supabase, context.userId);
    const workStart = data.workStart ?? prefs.work_start;
    const workEnd = data.workEnd ?? prefs.work_end;
    const tzOffsetMin = new Date().getTimezoneOffset();

    const start = new Date(`${data.startDate}T00:00:00`);
    const end = new Date(start.getTime() + data.days * 24 * 3600 * 1000);
    const { data: existing } = await context.supabase
      .from("appointments")
      .select("title,starts_at,ends_at")
      .gte("starts_at", start.toISOString())
      .lt("starts_at", end.toISOString());

    const system = `Break the user's goals into concrete, time-blocked appointments across ${data.days} day(s) starting ${data.startDate}.
- Working hours: ${workStart}–${workEnd}. User tz offset: ${-tzOffsetMin} min.
- Avoid conflicts with existing appointments.
- Each block should default to ${prefs.default_meeting_min} min (allow ${Math.max(30, prefs.default_meeting_min)}–90 min). Action-oriented title (verb + object).
- Spread work sensibly; don't pile everything on one day.
- 6–14 blocks total.

${prefsBlock(prefs)}

Return JSON: {"summary":string,"appointments":[{"title":string,"starts_at":ISO8601 w/ offset,"ends_at":ISO8601 w/ offset,"notes":string|null}]}`;

    const user = JSON.stringify({
      goals: data.goals,
      existing_appointments: existing ?? [],
    });
    const out = await callAI(system, user, key);
    const list = Array.isArray(out.appointments) ? out.appointments : [];
    if (list.length === 0) throw new Error("AI didn't produce any blocks. Try clearer goals.");

    const rows = list
      .filter((a: any) => a?.title && a?.starts_at && !Number.isNaN(Date.parse(a.starts_at)))
      .slice(0, 20)
      .map((a: any) => ({
        user_id: context.userId,
        title: String(a.title).slice(0, 200),
        starts_at: a.starts_at,
        ends_at: a.ends_at && !Number.isNaN(Date.parse(a.ends_at)) ? a.ends_at : null,
        notes: a.notes ? String(a.notes).slice(0, 1000) : null,
        source: "ai",
      }));

    const { error } = await context.supabase.from("appointments").insert(rows);
    if (error) throw error;
    return { summary: String(out.summary ?? "").slice(0, 400), created: rows.length };
  });

// ============ 4. Apply a generated day plan ============

const applyDaySchema = z.object({
  date: z.string(), // YYYY-MM-DD
  items: z.array(z.object({
    time: z.string(), // "HH:mm"
    title: z.string().min(1).max(200),
    kind: z.enum(["appointment", "block", "break"]),
    rationale: z.string().optional().nullable(),
    durationMin: z.number().int().min(5).max(480).optional(),
  })).min(1).max(30),
});

export const applyDayPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => applyDaySchema.parse(i))
  .handler(async ({ data, context }) => {
    const prefs = await loadPrefs(context.supabase, context.userId);
    // Only create new appointments for blocks/breaks; the "appointment" items
    // are already on the schedule (the AI was told not to move them).
    const candidates = data.items.filter((it) => it.kind !== "appointment");

    const tzOffsetMin = new Date().getTimezoneOffset();
    const sign = tzOffsetMin <= 0 ? "+" : "-";
    const abs = Math.abs(tzOffsetMin);
    const offset = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;

    const rows = candidates.map((it, idx) => {
      const [h, m] = it.time.split(":").map((n) => parseInt(n, 10));
      const start = new Date(`${data.date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00${offset}`);
      const fallback = it.kind === "break" ? prefs.break_length_min : prefs.default_meeting_min;
      let durationMin = it.durationMin ?? fallback;
      const next = candidates[idx + 1];
      if (!it.durationMin && next) {
        const [nh, nm] = next.time.split(":").map((n) => parseInt(n, 10));
        const diff = (nh * 60 + nm) - (h * 60 + m);
        if (diff > 0 && diff <= 240) durationMin = diff;
      }
      const end = new Date(start.getTime() + durationMin * 60 * 1000);
      return {
        user_id: context.userId,
        title: it.title.slice(0, 200),
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        notes: it.rationale ? it.rationale.slice(0, 1000) : null,
        source: "ai",
      };
    });

    if (rows.length === 0) {
      return { created: 0 };
    }
    const { error } = await context.supabase.from("appointments").insert(rows);
    if (error) throw error;
    return { created: rows.length };
  });
