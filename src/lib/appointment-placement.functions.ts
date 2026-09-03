import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  findPlacementConflicts,
  rankPlacementAlternatives,
  type BusyInterval,
  type PlacementAlternative,
  type PlacementConflict,
} from "./conflict-prevention";
import { computeGaps, prefsForDate } from "./tasks.server";

const isoSchema = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), "Invalid date and time");
const placementBaseSchema = z.object({
  startsAt: isoSchema,
  endsAt: isoSchema.nullable(),
  excludeId: z.string().uuid().nullable().default(null),
  tzOffsetMin: z.number().int().min(-900).max(900),
});

function validEnd(value: { startsAt: string; endsAt: string | null }, context: z.RefinementCtx) {
  if (value.endsAt && Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endsAt"],
      message: "End time must be after start time.",
    });
  }
}

const placementSchema = placementBaseSchema.superRefine(validEnd);

const createSchema = placementBaseSchema
  .omit({ excludeId: true })
  .extend({
    title: z.string().trim().min(1).max(200),
    location: z.string().trim().max(200).nullable(),
    notes: z.string().trim().max(1000).nullable(),
    source: z.enum(["manual", "ai", "quick_add"]),
    allowConflict: z.boolean().default(false),
  })
  .superRefine(validEnd);

const moveSchema = placementBaseSchema
  .extend({
    id: z.string().uuid(),
    allowConflict: z.boolean().default(false),
  })
  .superRefine(validEnd);

export type PlacementAssessment = {
  conflicts: PlacementConflict[];
  alternatives: PlacementAlternative[];
  workHours: { start: string; end: string; profile: string };
};

function localDateKey(iso: string, tzOffsetMin: number) {
  return new Date(Date.parse(iso) - tzOffsetMin * 60_000).toISOString().slice(0, 10);
}

function wallClockMs(date: string, time: string, tzOffsetMin: number) {
  return Date.parse(`${date}T${time}:00Z`) + tzOffsetMin * 60_000;
}

async function assessPlacement(
  supabase: Parameters<typeof prefsForDate>[0],
  userId: string,
  input: z.infer<typeof placementSchema>,
): Promise<PlacementAssessment> {
  const date = localDateKey(input.startsAt, input.tzOffsetMin);
  const prefs = await prefsForDate(supabase, userId, date);
  const dayStart = wallClockMs(date, "00:00", input.tzOffsetMin);
  const dayEnd = dayStart + 24 * 60 * 60_000;

  const { data, error } = await supabase
    .from("schedule_hub_events")
    .select("id,title,starts_at,ends_at,is_all_day")
    .gte("starts_at", new Date(dayStart - 24 * 60 * 60_000).toISOString())
    .lt("starts_at", new Date(dayEnd).toISOString())
    .order("starts_at")
    .limit(250);
  if (error) throw error;

  const events = (data ?? []) as BusyInterval[];
  const conflicts = findPlacementConflicts(input.startsAt, input.endsAt, events, input.excludeId);
  if (conflicts.length === 0) {
    return {
      conflicts: [],
      alternatives: [],
      workHours: { start: prefs.work_start, end: prefs.work_end, profile: prefs.name },
    };
  }

  const busy = events.flatMap((event) => {
    if (event.id === input.excludeId || event.is_all_day) return [];
    const start = Date.parse(event.starts_at);
    const parsedEnd = event.ends_at ? Date.parse(event.ends_at) : Number.NaN;
    return [
      {
        start,
        end: Number.isFinite(parsedEnd) && parsedEnd > start ? parsedEnd : start + 30 * 60_000,
      },
    ];
  });
  const gaps = computeGaps(
    date,
    prefs,
    busy,
    date === localDateKey(new Date().toISOString(), input.tzOffsetMin) ? Date.now() : dayStart,
    input.tzOffsetMin,
  );

  return {
    conflicts,
    alternatives: rankPlacementAlternatives(input.startsAt, input.endsAt, gaps),
    workHours: { start: prefs.work_start, end: prefs.work_end, profile: prefs.name },
  };
}

function conflictMessage(conflicts: PlacementConflict[]) {
  const first = conflicts[0]?.title ?? "another commitment";
  return `That time now overlaps ${first}. Review the latest schedule before saving.`;
}

export const previewAppointmentPlacement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => placementSchema.parse(input))
  .handler(({ data, context }) => assessPlacement(context.supabase, context.userId, data));

export const createProtectedAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createSchema.parse(input))
  .handler(async ({ data, context }) => {
    const assessment = await assessPlacement(context.supabase, context.userId, {
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      excludeId: null,
      tzOffsetMin: data.tzOffsetMin,
    });
    if (!data.allowConflict && assessment.conflicts.length > 0) {
      throw new Error(conflictMessage(assessment.conflicts));
    }

    const { data: appointment, error } = await context.supabase
      .from("appointments")
      .insert({
        user_id: context.userId,
        title: data.title,
        starts_at: data.startsAt,
        ends_at: data.endsAt,
        location: data.location || null,
        notes: data.notes || null,
        source: data.source,
        commitment_type: "flexible",
      })
      .select("id")
      .single();
    if (error) throw error;
    return { id: appointment.id, conflictsAccepted: assessment.conflicts.length };
  });

export const moveProtectedAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => moveSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: current, error: readError } = await context.supabase
      .from("appointments")
      .select("id,commitment_type,is_all_day,calendar_event_id,source")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (readError) throw readError;
    if (!current) throw new Error("That appointment no longer exists.");
    if (
      current.commitment_type !== "flexible" ||
      current.is_all_day ||
      current.calendar_event_id ||
      current.source === "calendar_import"
    ) {
      throw new Error("That fixed commitment cannot be moved by Chronos-V.");
    }

    const assessment = await assessPlacement(context.supabase, context.userId, {
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      excludeId: data.id,
      tzOffsetMin: data.tzOffsetMin,
    });
    if (!data.allowConflict && assessment.conflicts.length > 0) {
      throw new Error(conflictMessage(assessment.conflicts));
    }

    const { error } = await context.supabase
      .from("appointments")
      .update({ starts_at: data.startsAt, ends_at: data.endsAt })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { id: data.id, conflictsAccepted: assessment.conflicts.length };
  });
