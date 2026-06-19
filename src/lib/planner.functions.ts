import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

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
  date: z.string(), // ISO date "YYYY-MM-DD"
  workStart: z.string().default("09:00"),
  workEnd: z.string().default("18:00"),
  goals: z.string().max(500).optional(),
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
- Keep blocks 25–90 min. Add a lunch break.
Return JSON:
{"summary": string (1-2 sentences), "items": [{"time":"HH:mm","title":string,"kind":"appointment"|"block"|"break","rationale":string}]}`;

    const user = JSON.stringify({
      date: data.date,
      working_hours: `${data.workStart}–${data.workEnd}`,
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
    const now = data.now ?? new Date().toISOString();
    const tzOffsetMin = new Date().getTimezoneOffset();

    const system = `Turn the user's request into ONE scheduled appointment.
Now: ${now}. User timezone offset: ${-tzOffsetMin} min from UTC.
Resolve relative phrases ("tomorrow morning", "Friday afternoon", "in 2 hours") against now.
Defaults: morning=09:00, afternoon=14:00, evening=19:00. Default duration 30 min unless stated.
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
  startDate: z.string(), // YYYY-MM-DD
  days: z.number().int().min(1).max(14).default(7),
  workStart: z.string().default("09:00"),
  workEnd: z.string().default("18:00"),
});

export const planWeek = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => weekSchema.parse(i))
  .handler(async ({ data, context }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const tzOffsetMin = new Date().getTimezoneOffset();

    const start = new Date(`${data.startDate}T00:00:00`);
    const end = new Date(start.getTime() + data.days * 24 * 3600 * 1000);
    const { data: existing } = await context.supabase
      .from("appointments")
      .select("title,starts_at,ends_at")
      .gte("starts_at", start.toISOString())
      .lt("starts_at", end.toISOString());

    const system = `Break the user's goals into concrete, time-blocked appointments across ${data.days} day(s) starting ${data.startDate}.
- Working hours: ${data.workStart}–${data.workEnd}. User tz offset: ${-tzOffsetMin} min.
- Avoid conflicts with existing appointments.
- Make each block 30–90 min, action-oriented title (verb + object).
- Spread work sensibly; don't pile everything on one day.
- 6–14 blocks total.
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
