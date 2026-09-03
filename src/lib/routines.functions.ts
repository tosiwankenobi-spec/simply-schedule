import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  generateRoutineOccurrences,
  isValidTimeZone,
  ROUTINE_WINDOW_DAYS,
  type RoutineDefinition,
} from "./routines";

type AppSupabase = SupabaseClient<Database>;

export type RoutineRow = RoutineDefinition & {
  user_id: string;
  created_at: string;
  updated_at: string;
};

const ROUTINE_COLUMNS =
  "id,user_id,title,category,frequency,days_of_week,local_time,duration_min,start_date,end_date,timezone,location,notes,commitment_type,active,created_at,updated_at";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .transform((value) => `${value}:00`);

const routineSchema = z
  .object({
    id: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(200),
    category: z.enum([
      "medication",
      "exercise",
      "pickup",
      "meal",
      "household",
      "bill",
      "pet",
      "other",
    ]),
    frequency: z.enum(["daily", "weekly"]),
    days_of_week: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    local_time: timeSchema,
    duration_min: z.number().int().min(5).max(480),
    start_date: dateSchema,
    end_date: dateSchema.nullable(),
    timezone: z.string().min(1).max(100).refine(isValidTimeZone, "Invalid timezone"),
    location: z.string().trim().max(200).nullable(),
    notes: z.string().trim().max(1000).nullable(),
    commitment_type: z.enum(["fixed", "flexible"]),
    active: z.boolean(),
    fromDate: dateSchema,
  })
  .superRefine((value, context) => {
    if (value.end_date && value.end_date < value.start_date) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end_date"],
        message: "End date must be on or after the start date.",
      });
    }
    if (new Set(value.days_of_week).size !== value.days_of_week.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["days_of_week"],
        message: "Routine days must be unique.",
      });
    }
  });

const maintenanceSchema = z.object({ fromDate: dateSchema });
const idSchema = z.object({ id: z.string().uuid(), fromDate: dateSchema });

function appointmentRows(routine: RoutineRow, userId: string, fromDate: string) {
  return generateRoutineOccurrences(routine, fromDate).map((occurrence) => ({
    user_id: userId,
    title: routine.title,
    notes: routine.notes,
    location: routine.location,
    starts_at: occurrence.startsAt,
    ends_at: occurrence.endsAt,
    source: "routine",
    timezone: routine.timezone,
    is_all_day: false,
    commitment_type: routine.commitment_type,
    recurrence_rule: occurrence.recurrenceRule,
    privacy_level: "private",
    sync_status: "local",
    provider: "chronos",
    routine_id: routine.id,
    routine_occurrence_date: occurrence.occurrenceDate,
    source_metadata: { routine_category: routine.category },
  }));
}

async function insertInChunks(supabase: AppSupabase, rows: ReturnType<typeof appointmentRows>) {
  for (let index = 0; index < rows.length; index += 250) {
    const { error } = await supabase.from("appointments").upsert(rows.slice(index, index + 250), {
      onConflict: "routine_id,routine_occurrence_date",
      ignoreDuplicates: true,
    });
    if (error) throw error;
  }
}

async function replaceFutureOccurrences(
  supabase: AppSupabase,
  routine: RoutineRow,
  userId: string,
  fromDate: string,
) {
  const { error: deleteError } = await supabase
    .from("appointments")
    .delete()
    .eq("user_id", userId)
    .eq("routine_id", routine.id)
    .gte("routine_occurrence_date", fromDate);
  if (deleteError) throw deleteError;
  if (!routine.active) return 0;
  const rows = appointmentRows(routine, userId, fromDate);
  await insertInChunks(supabase, rows);
  return rows.length;
}

export const listRoutines = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RoutineRow[]> => {
    const { data, error } = await context.supabase
      .from("routines")
      .select(ROUTINE_COLUMNS)
      .eq("user_id", context.userId)
      .order("active", { ascending: false })
      .order("title");
    if (error) throw error;
    return (data ?? []) as RoutineRow[];
  });

export const saveRoutine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => routineSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ routine: RoutineRow; materialized: number }> => {
    const row = {
      user_id: context.userId,
      title: data.title,
      category: data.category,
      frequency: data.frequency,
      days_of_week: [...new Set(data.days_of_week)].sort(),
      local_time: data.local_time,
      duration_min: data.duration_min,
      start_date: data.start_date,
      end_date: data.end_date,
      timezone: data.timezone,
      location: data.location || null,
      notes: data.notes || null,
      commitment_type: data.commitment_type,
      active: data.active,
    };

    const result = data.id
      ? await context.supabase
          .from("routines")
          .update(row)
          .eq("id", data.id)
          .eq("user_id", context.userId)
          .select(ROUTINE_COLUMNS)
          .maybeSingle()
      : await context.supabase.from("routines").insert(row).select(ROUTINE_COLUMNS).single();
    if (result.error) throw result.error;
    if (!result.data) throw new Error("That routine is no longer available.");

    const routine = result.data as RoutineRow;
    const materialized = await replaceFutureOccurrences(
      context.supabase,
      routine,
      context.userId,
      data.fromDate,
    );
    return { routine, materialized };
  });

export const setRoutineActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idSchema.extend({ active: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: routine, error } = await context.supabase
      .from("routines")
      .update({ active: data.active })
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .select(ROUTINE_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    if (!routine) throw new Error("That routine is no longer available.");
    const materialized = await replaceFutureOccurrences(
      context.supabase,
      routine as RoutineRow,
      context.userId,
      data.fromDate,
    );
    return { active: data.active, materialized };
  });

export const deleteRoutine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error: appointmentError } = await context.supabase
      .from("appointments")
      .delete()
      .eq("user_id", context.userId)
      .eq("routine_id", data.id)
      .gte("routine_occurrence_date", data.fromDate);
    if (appointmentError) throw appointmentError;
    const { error } = await context.supabase
      .from("routines")
      .delete()
      .eq("user_id", context.userId)
      .eq("id", data.id);
    if (error) throw error;
    return { deleted: true };
  });

export const maintainRoutineSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => maintenanceSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ materialized: number; windowDays: number }> => {
    const { data: routines, error } = await context.supabase
      .from("routines")
      .select(ROUTINE_COLUMNS)
      .eq("user_id", context.userId)
      .eq("active", true)
      .limit(100);
    if (error) throw error;
    const rows = (routines ?? []).flatMap((routine) =>
      appointmentRows(routine as RoutineRow, context.userId, data.fromDate),
    );
    if (rows.length === 0) return { materialized: 0, windowDays: ROUTINE_WINDOW_DAYS };

    const { data: existing, error: existingError } = await context.supabase
      .from("appointments")
      .select("routine_id,routine_occurrence_date")
      .eq("user_id", context.userId)
      .not("routine_id", "is", null)
      .gte("routine_occurrence_date", data.fromDate);
    if (existingError) throw existingError;
    const existingKeys = new Set(
      (existing ?? []).map((row) => `${row.routine_id}:${row.routine_occurrence_date}`),
    );
    const missing = rows.filter(
      (row) => !existingKeys.has(`${row.routine_id}:${row.routine_occurrence_date}`),
    );
    await insertInChunks(context.supabase, missing);
    return { materialized: missing.length, windowDays: ROUTINE_WINDOW_DAYS };
  });
