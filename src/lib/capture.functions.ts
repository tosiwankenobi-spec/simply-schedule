import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

export type CaptureIntent = "appointment" | "task" | "scheduled_task" | "find_time";

export type CaptureDraft = {
  intent: CaptureIntent;
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  location: string | null;
  notes: string | null;
  estimated_min: number;
  deadline: string | null;
  priority: 1 | 2 | 3;
  energy: "deep" | "light" | "any";
  schedule_reason: string | null;
  conflicts: string[];
};

const parseSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  timeZone: z.string().max(64).default("UTC"),
  tzOffsetMin: z.number().int().min(-900).max(900).default(0),
});

const intentSchema = z.enum(["appointment", "task", "scheduled_task", "find_time"]);
const energySchema = z.enum(["deep", "light", "any"]);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoSchema = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), "Invalid date and time");

const confirmSchema = z
  .object({
    intent: intentSchema,
    title: z.string().trim().min(1).max(200),
    starts_at: isoSchema.nullable(),
    ends_at: isoSchema.nullable(),
    location: z.string().trim().max(200).nullable(),
    notes: z.string().trim().max(1000).nullable(),
    estimated_min: z.number().int().min(10).max(480),
    deadline: dateSchema.nullable(),
    priority: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    energy: energySchema,
    schedule_reason: z.string().max(500).nullable(),
    conflicts: z.array(z.string().max(200)).max(10),
  })
  .superRefine((draft, context) => {
    if ((draft.intent === "appointment" || draft.intent === "scheduled_task") && !draft.starts_at) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["starts_at"],
        message: "A start time is required.",
      });
    }
    if (
      draft.starts_at &&
      draft.ends_at &&
      Date.parse(draft.ends_at) <= Date.parse(draft.starts_at)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ends_at"],
        message: "End time must be after start time.",
      });
    }
  });

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanString(value: unknown, max: number) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, max) : null;
}

function cleanIso(value: unknown) {
  const text = cleanString(value, 80);
  return text && Number.isFinite(Date.parse(text)) ? text : null;
}

function validDate(value: unknown) {
  const text = cleanString(value, 10);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split("-").map(Number);
  const roundTrip = new Date(Date.UTC(year!, month! - 1, day!)).toISOString().slice(0, 10);
  return roundTrip === text ? text : null;
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

function localDateKey(nowMs: number, tzOffsetMin: number) {
  return new Date(nowMs - tzOffsetMin * 60000).toISOString().slice(0, 10);
}

function wallClockMs(date: string, time: string, tzOffsetMin: number) {
  return Date.parse(`${date}T${time}:00Z`) + tzOffsetMin * 60000;
}

function normalizeDraft(value: unknown, today: string): CaptureDraft {
  const raw = asRecord(value);
  const parsedStartsAt = cleanIso(raw.starts_at);
  const parsedIntent = intentSchema.safeParse(raw.intent);
  const intent = parsedIntent.success ? parsedIntent.data : parsedStartsAt ? "appointment" : "task";
  const startsAt = intent === "task" || intent === "find_time" ? null : parsedStartsAt;
  const title = cleanString(raw.title, 200);
  if (!title) throw new Error("Couldn't find a clear title. Try rephrasing.");
  if ((intent === "appointment" || intent === "scheduled_task") && !startsAt) {
    throw new Error("Couldn't find a clear start time. Try adding a day and time.");
  }

  const duration = Number(raw.estimated_min);
  const estimatedMin = Number.isInteger(duration) ? Math.min(480, Math.max(10, duration)) : 30;
  const priorityValue = Number(raw.priority);
  const priority: 1 | 2 | 3 = priorityValue === 1 || priorityValue === 3 ? priorityValue : 2;
  const parsedEnergy = energySchema.safeParse(raw.energy);
  const deadline = validDate(raw.deadline) ?? (intent === "find_time" ? addDays(today, 7) : null);
  let endsAt = cleanIso(raw.ends_at);
  if (startsAt && !endsAt && intent !== "appointment") {
    endsAt = new Date(Date.parse(startsAt) + estimatedMin * 60000).toISOString();
  }

  return {
    intent,
    title,
    starts_at: startsAt,
    ends_at: endsAt,
    location: cleanString(raw.location, 200),
    notes: cleanString(raw.notes, 1000),
    estimated_min: estimatedMin,
    deadline,
    priority,
    energy: parsedEnergy.success ? parsedEnergy.data : "any",
    schedule_reason: null,
    conflicts: [],
  };
}

async function callCaptureAI(system: string, text: string, key: string) {
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: system },
        { role: "user", content: text },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    }),
  });
  if (response.status === 429) throw new Error("Rate limit reached. Try again in a moment.");
  if (response.status === 402)
    throw new Error("AI credits are exhausted — add credits in Settings.");
  if (!response.ok) throw new Error(`AI request failed (${response.status}).`);

  const payload = asRecord(await response.json());
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = asRecord(choices[0]);
  const message = asRecord(first.message);
  let content = typeof message.content === "string" ? message.content.trim() : "";
  content = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(content) as unknown;
  } catch {
    const object = content.match(/\{[\s\S]*\}/)?.[0];
    if (!object) throw new Error("AI returned malformed data. Try rephrasing.");
    try {
      return JSON.parse(object) as unknown;
    } catch {
      throw new Error("AI returned malformed data. Try rephrasing.");
    }
  }
}

async function suggestSlot(input: {
  supabase: SupabaseClient<Database>;
  userId: string;
  draft: CaptureDraft;
  today: string;
  nowMs: number;
  tzOffsetMin: number;
}) {
  const { prefsForDate, computeGaps } = await import("./tasks.server");
  const lastAllowed = input.draft.deadline ?? addDays(input.today, 7);
  for (let offset = 0; offset < 14; offset++) {
    const date = addDays(input.today, offset);
    if (date > lastAllowed) break;
    const dayStart = wallClockMs(date, "00:00", input.tzOffsetMin);
    const dayEnd = wallClockMs(addDays(date, 1), "00:00", input.tzOffsetMin);
    const [{ data: appointments, error }, prefs] = await Promise.all([
      input.supabase
        .from("appointments")
        .select("starts_at,ends_at,is_all_day")
        .eq("user_id", input.userId)
        .gte("starts_at", new Date(dayStart).toISOString())
        .lt("starts_at", new Date(dayEnd).toISOString())
        .order("starts_at"),
      prefsForDate(input.supabase, input.userId, date),
    ]);
    if (error) throw error;
    const busy = (appointments ?? [])
      .filter((appointment) => !appointment.is_all_day)
      .map((appointment) => {
        const start = Date.parse(appointment.starts_at);
        const explicitEnd = appointment.ends_at ? Date.parse(appointment.ends_at) : Number.NaN;
        return { start, end: Number.isFinite(explicitEnd) ? explicitEnd : start + 30 * 60000 };
      });
    const gaps = computeGaps(date, prefs, busy, input.nowMs, input.tzOffsetMin);
    const durationMs = input.draft.estimated_min * 60000;
    const gap = gaps.find((candidate) => candidate.end - candidate.start >= durationMs);
    if (gap) {
      return {
        starts_at: new Date(gap.start).toISOString(),
        ends_at: new Date(gap.start + durationMs).toISOString(),
        reason: `First ${input.draft.estimated_min}-minute opening inside ${prefs.name} working hours, with appointments and lunch protected.`,
      };
    }
  }
  return null;
}

async function findConflicts(input: {
  supabase: SupabaseClient<Database>;
  userId: string;
  startsAt: string;
  endsAt: string | null;
  estimatedMin: number;
}) {
  const start = Date.parse(input.startsAt);
  const end = input.endsAt ? Date.parse(input.endsAt) : start + input.estimatedMin * 60000;
  const queryStart = new Date(start - 24 * 3600 * 1000).toISOString();
  const { data, error } = await input.supabase
    .from("appointments")
    .select("title,starts_at,ends_at,is_all_day")
    .eq("user_id", input.userId)
    .gte("starts_at", queryStart)
    .lt("starts_at", new Date(end).toISOString())
    .order("starts_at")
    .limit(20);
  if (error) throw error;
  return (data ?? [])
    .filter((appointment) => {
      if (appointment.is_all_day) return false;
      const existingStart = Date.parse(appointment.starts_at);
      const explicitEnd = appointment.ends_at ? Date.parse(appointment.ends_at) : Number.NaN;
      const existingEnd = Number.isFinite(explicitEnd) ? explicitEnd : existingStart + 30 * 60000;
      return existingStart < end && existingEnd > start;
    })
    .map((appointment) => appointment.title)
    .slice(0, 5);
}

export const parseNaturalLanguageCapture = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => parseSchema.parse(input))
  .handler(async ({ data, context }): Promise<CaptureDraft> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Natural-language capture is not connected yet.");
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const localNow = new Date(nowMs - data.tzOffsetMin * 60000).toISOString().replace("Z", "");
    const today = localDateKey(nowMs, data.tzOffsetMin);
    const system = `You classify and extract ONE scheduling item for Chronos-V.

CURRENT CONTEXT
- Now UTC: ${nowIso}
- User local time: ${localNow}
- IANA timezone: ${data.timeZone}
- UTC offset in minutes: ${-data.tzOffsetMin}
- Resolve relative dates against the user's local time and choose future occurrences.

INTENTS
- appointment: a fixed commitment with an explicit date/time, such as "Dentist Thursday at 2".
- scheduled_task: an action or reminder with an explicit date/time, such as "remind me to call Mom tonight".
- find_time: work the user wants Chronos-V to place in a window, such as "find 90 minutes this week for taxes".
- task: an action without a specific scheduled time, optionally with a deadline.

RULES
- Do not turn flexible work into an appointment just because it has a deadline.
- starts_at and ends_at are ISO 8601 with an offset, or null. Only appointment and scheduled_task require starts_at.
- For find_time, leave starts_at and ends_at null; set deadline to the end of the requested window.
- deadline is YYYY-MM-DD or null. estimated_min is 10–480, default 30.
- priority is 1 high, 2 normal, 3 low. energy is deep, light, or any.
- location is a physical place or meeting link, otherwise null.

Return ONLY this JSON object:
{"intent":"appointment|task|scheduled_task|find_time","title":string,"starts_at":string|null,"ends_at":string|null,"location":string|null,"notes":string|null,"estimated_min":number,"deadline":"YYYY-MM-DD"|null,"priority":1|2|3,"energy":"deep|light|any"}`;
    const raw = await callCaptureAI(system, data.text, key);
    const draft = normalizeDraft(raw, today);
    if (draft.intent === "find_time") {
      const slot = await suggestSlot({
        supabase: context.supabase,
        userId: context.userId,
        draft,
        today,
        nowMs,
        tzOffsetMin: data.tzOffsetMin,
      });
      if (slot) {
        draft.starts_at = slot.starts_at;
        draft.ends_at = slot.ends_at;
        draft.schedule_reason = slot.reason;
      } else {
        draft.schedule_reason =
          "No suitable opening was found before the requested deadline. Save it as an open task instead.";
      }
    }
    if (draft.starts_at) {
      draft.conflicts = await findConflicts({
        supabase: context.supabase,
        userId: context.userId,
        startsAt: draft.starts_at,
        endsAt: draft.ends_at,
        estimatedMin: draft.estimated_min,
      });
    }
    return draft;
  });

export const confirmNaturalLanguageCapture = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => confirmSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (data.intent === "appointment") {
      const { data: appointment, error } = await context.supabase
        .from("appointments")
        .insert({
          user_id: context.userId,
          title: data.title,
          starts_at: data.starts_at!,
          ends_at: data.ends_at,
          location: data.location || null,
          notes: data.notes || null,
          source: "quick_add",
          commitment_type: "fixed",
        })
        .select("id")
        .single();
      if (error) throw error;
      return {
        kind: "appointment" as const,
        taskId: null,
        appointmentId: appointment.id,
        scheduled: true,
      };
    }

    if (data.starts_at) {
      const conflicts = await findConflicts({
        supabase: context.supabase,
        userId: context.userId,
        startsAt: data.starts_at,
        endsAt: data.ends_at,
        estimatedMin: data.estimated_min,
      });
      if (conflicts.length > 0) {
        throw new Error(
          `That time now overlaps ${conflicts[0]}. Review the capture to choose another slot.`,
        );
      }
    }

    const { data: task, error: taskError } = await context.supabase
      .from("tasks")
      .insert({
        user_id: context.userId,
        title: data.title,
        notes: data.notes || null,
        estimated_min: data.estimated_min,
        priority: data.priority,
        energy: data.energy,
        deadline: data.deadline,
        status: "open",
      })
      .select("id")
      .single();
    if (taskError) throw taskError;

    if (!data.starts_at) {
      return { kind: "task" as const, taskId: task.id, appointmentId: null, scheduled: false };
    }

    const endsAt =
      data.ends_at ??
      new Date(Date.parse(data.starts_at) + data.estimated_min * 60000).toISOString();
    const { data: appointment, error: appointmentError } = await context.supabase
      .from("appointments")
      .insert({
        user_id: context.userId,
        title: data.title,
        starts_at: data.starts_at,
        ends_at: endsAt,
        location: data.location || null,
        notes: data.notes || "Scheduled from natural-language capture",
        source: "task",
        commitment_type: "flexible",
      })
      .select("id")
      .single();
    if (appointmentError) {
      await context.supabase.from("tasks").delete().eq("id", task.id).eq("user_id", context.userId);
      throw appointmentError;
    }

    const { error: linkError } = await context.supabase
      .from("tasks")
      .update({ status: "scheduled", scheduled_appointment_id: appointment.id })
      .eq("id", task.id)
      .eq("user_id", context.userId);
    if (linkError) {
      await Promise.all([
        context.supabase
          .from("appointments")
          .delete()
          .eq("id", appointment.id)
          .eq("user_id", context.userId),
        context.supabase.from("tasks").delete().eq("id", task.id).eq("user_id", context.userId),
      ]);
      throw linkError;
    }

    return {
      kind: "task" as const,
      taskId: task.id,
      appointmentId: appointment.id,
      scheduled: true,
    };
  });
