import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildNowRecommendation,
  type NowAppointment,
  type NowRecommendation,
  type NowTask,
} from "./now-recommendation";
import type { NotifPrefs } from "./notifications.server";

const nowSchema = z.object({
  timezoneOffsetMinutes: z.number().int().min(-900).max(900),
});

export const recommendNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => nowSchema.parse(input))
  .handler(async ({ data, context }): Promise<NowRecommendation> => {
    const { DEFAULT_PREFS, NOTIF_COLS } = await import("./notifications.server");
    const now = new Date();
    const appointmentFloor = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const appointmentCeiling = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const [tasksResult, appointmentsResult, preferencesResult] = await Promise.all([
      context.supabase
        .from("tasks")
        .select("id,title,estimated_min,priority,deadline")
        .eq("user_id", context.userId)
        .eq("status", "open"),
      context.supabase
        .from("appointments")
        .select("id,title,starts_at,ends_at,location,travel_minutes,preparation_minutes")
        .eq("user_id", context.userId)
        .eq("is_all_day", false)
        .gte("starts_at", appointmentFloor.toISOString())
        .lt("starts_at", appointmentCeiling.toISOString())
        .order("starts_at"),
      context.supabase
        .from("notification_prefs")
        .select(NOTIF_COLS)
        .eq("user_id", context.userId)
        .maybeSingle(),
    ]);

    if (tasksResult.error) throw tasksResult.error;
    if (appointmentsResult.error) throw appointmentsResult.error;
    if (preferencesResult.error) throw preferencesResult.error;

    return buildNowRecommendation({
      now,
      timezoneOffsetMinutes: data.timezoneOffsetMinutes,
      tasks: (tasksResult.data ?? []) as NowTask[],
      appointments: (appointmentsResult.data ?? []) as NowAppointment[],
      travelPreferences: (preferencesResult.data as NotifPrefs | null) ?? DEFAULT_PREFS,
    });
  });
