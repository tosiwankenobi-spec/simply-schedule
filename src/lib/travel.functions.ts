import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  calculateTravelGuidance,
  DEFAULT_TRAVEL_PREFERENCES,
  type TravelAppointment,
  type TravelGuidance,
  type TravelMode,
  type TravelPreferences,
} from "./travel-intelligence";

export type NextTravelGuidance = TravelGuidance & {
  travelOverride: number | null;
  preparationOverride: number | null;
};

const travelModeSchema = z.enum(["driving", "transit", "walking", "cycling", "other"]);

function normalizePreferences(row: Record<string, unknown> | null): TravelPreferences {
  if (!row) return DEFAULT_TRAVEL_PREFERENCES;
  const parsedMode = travelModeSchema.safeParse(row.travel_mode);
  return {
    travel_reminders_enabled:
      typeof row.travel_reminders_enabled === "boolean"
        ? row.travel_reminders_enabled
        : DEFAULT_TRAVEL_PREFERENCES.travel_reminders_enabled,
    travel_mode: parsedMode.success
      ? (parsedMode.data as TravelMode)
      : DEFAULT_TRAVEL_PREFERENCES.travel_mode,
    default_travel_min:
      typeof row.default_travel_min === "number"
        ? row.default_travel_min
        : DEFAULT_TRAVEL_PREFERENCES.default_travel_min,
    travel_buffer_min:
      typeof row.travel_buffer_min === "number"
        ? row.travel_buffer_min
        : DEFAULT_TRAVEL_PREFERENCES.travel_buffer_min,
    default_prep_min:
      typeof row.default_prep_min === "number"
        ? row.default_prep_min
        : DEFAULT_TRAVEL_PREFERENCES.default_prep_min,
  };
}

export const getNextTravelGuidance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<NextTravelGuidance | null> => {
    const now = Date.now();
    const horizon = new Date(now + 7 * 86400000).toISOString();
    const [appointmentResult, preferenceResult] = await Promise.all([
      context.supabase
        .from("appointments")
        .select("id,title,starts_at,location,travel_minutes,preparation_minutes,is_all_day")
        .eq("user_id", context.userId)
        .eq("is_all_day", false)
        .not("location", "is", null)
        .gte("starts_at", new Date(now).toISOString())
        .lte("starts_at", horizon)
        .order("starts_at")
        .limit(30),
      context.supabase
        .from("notification_prefs")
        .select(
          "travel_reminders_enabled,travel_mode,default_travel_min,travel_buffer_min,default_prep_min",
        )
        .eq("user_id", context.userId)
        .maybeSingle(),
    ]);
    if (appointmentResult.error) throw appointmentResult.error;
    if (preferenceResult.error) throw preferenceResult.error;

    const preferences = normalizePreferences(
      (preferenceResult.data as Record<string, unknown> | null) ?? null,
    );
    for (const row of appointmentResult.data ?? []) {
      const appointment = row as TravelAppointment;
      const guidance = calculateTravelGuidance(appointment, preferences, now);
      if (guidance) {
        return {
          ...guidance,
          travelOverride: appointment.travel_minutes ?? null,
          preparationOverride: appointment.preparation_minutes ?? null,
        };
      }
    }
    return null;
  });

const overrideSchema = z.object({
  appointmentId: z.string().uuid(),
  travelMinutes: z.number().int().min(1).max(720).nullable(),
  preparationMinutes: z.number().int().min(0).max(240).nullable(),
});

export const updateAppointmentTravel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => overrideSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ updated: true }> => {
    const { data: updated, error } = await context.supabase
      .from("appointments")
      .update({
        travel_minutes: data.travelMinutes,
        preparation_minutes: data.preparationMinutes,
      })
      .eq("user_id", context.userId)
      .eq("id", data.appointmentId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!updated) throw new Error("That appointment is no longer available.");
    return { updated: true };
  });
