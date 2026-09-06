import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  FORECAST_HORIZON_DAYS,
  buildCapacityForecast,
  forecastDates,
  normalizeTimeZone,
  overlapsRange,
  resolveProfileIdForDate,
  zonedInstant,
  type CapacityForecast,
  type ForecastDayInput,
  type ForecastTask,
  type ProfileAssignment,
} from "./capacity-forecast";
import type { PlannerScheduleEvent, Prefs } from "./tasks.server";

const inputSchema = z.object({
  /** IANA zone from the browser; anything unrecognised falls back to UTC. */
  timeZone: z.string().max(80).optional(),
  horizonDays: z.number().int().min(1).max(21).default(FORECAST_HORIZON_DAYS),
});

/** Working-hours shape only — planner notes are never needed by the forecast. */
const PROFILE_COLS =
  "id,name,is_default,work_start,work_end,default_meeting_min,break_every_min,break_length_min,lunch_at,lunch_length_min";

/** Only the travel/preparation fields; no email_to or unrelated reminder settings. */
const TRAVEL_PREF_COLS =
  "travel_reminders_enabled,travel_mode,default_travel_min,travel_buffer_min,default_prep_min";

/**
 * Events beginning before the window can still overlap it. Anything longer than
 * this is treated as an all-day/multi-day marker by the planner and ignored, so
 * a bounded look-back is enough to catch every real overlap.
 */
const OVERLAP_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * Read-only 14-day capacity forecast. Never writes, never calls AI, and returns
 * only display fields — no notes, provider identifiers or connection metadata.
 */
export const getCapacityForecast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => inputSchema.parse(i))
  .handler(async ({ data, context }): Promise<CapacityForecast> => {
    const [tasksServer, notificationsServer, travelIntelligence] = await Promise.all([
      import("./tasks.server"),
      import("./notifications.server"),
      import("./travel-intelligence"),
    ]);

    const nowMs = Date.now();
    const timeZone = normalizeTimeZone(data.timeZone);
    const dates = forecastDates(timeZone, nowMs, data.horizonDays);
    const firstDate = dates[0]!;
    const lastDate = dates[dates.length - 1]!;
    const rangeStartMs = firstDate.startMs;
    const rangeEndMs = lastDate.endMs;
    const rangeStart = new Date(rangeStartMs).toISOString();
    const rangeEnd = new Date(rangeEndMs).toISOString();
    // Query by overlap, not by start instant, so a commitment that begins before
    // a boundary (overnight, or before the horizon starts) still occupies time.
    const queryStart = new Date(rangeStartMs - OVERLAP_LOOKBACK_MS).toISOString();
    const blockLookbackStart = new Date(nowMs - 45 * 86400000).toISOString();

    const [
      scheduleResult,
      metadataResult,
      taskBlockResult,
      tasksResult,
      notificationResult,
      assignmentResult,
      profileResult,
    ] = await Promise.all([
      context.supabase
        .from("schedule_hub_events")
        .select("id,title,starts_at,ends_at,location,is_all_day")
        .gte("starts_at", queryStart)
        .lt("starts_at", rangeEnd)
        .order("starts_at"),
      context.supabase
        .from("appointments")
        .select("id,travel_minutes,preparation_minutes")
        .eq("user_id", context.userId)
        .gte("starts_at", queryStart)
        .lt("starts_at", rangeEnd),
      context.supabase
        .from("appointments")
        .select("id,starts_at,ends_at")
        .eq("user_id", context.userId)
        .eq("source", "task")
        .gte("starts_at", blockLookbackStart),
      context.supabase
        .from("tasks")
        .select(
          "id,title,estimated_min,priority,deadline,status,created_at,scheduled_appointment_id",
        )
        .eq("user_id", context.userId)
        .neq("status", "done"),
      context.supabase
        .from("notification_prefs")
        .select(TRAVEL_PREF_COLS)
        .eq("user_id", context.userId)
        .maybeSingle(),
      context.supabase
        .from("planner_profile_assignments")
        .select("profile_id,start_date,end_date")
        .eq("user_id", context.userId)
        .lte("start_date", lastDate.date)
        .gte("end_date", firstDate.date)
        .order("created_at", { ascending: false }),
      context.supabase
        .from("planner_profiles")
        .select(PROFILE_COLS)
        .eq("user_id", context.userId)
        .order("is_default", { ascending: false }),
    ]);

    if (
      scheduleResult.error ||
      metadataResult.error ||
      taskBlockResult.error ||
      tasksResult.error ||
      notificationResult.error ||
      assignmentResult.error ||
      profileResult.error
    ) {
      throw new Error("Your forecast could not be built right now. Please try again.");
    }

    const metadata = new Map((metadataResult.data ?? []).map((row) => [row.id, row]));
    const schedule: PlannerScheduleEvent[] = (scheduleResult.data ?? []).flatMap((event) => {
      if (!event.id || !event.starts_at) return [];
      if (!overlapsRange(event, rangeStartMs, rangeEndMs)) return [];
      const own = metadata.get(event.id);
      return [
        {
          id: event.id,
          title: event.title || "Busy",
          starts_at: event.starts_at,
          ends_at: event.ends_at,
          location: event.location,
          is_all_day: event.is_all_day ?? false,
          travel_minutes: own?.travel_minutes ?? null,
          preparation_minutes: own?.preparation_minutes ?? null,
        },
      ];
    });

    const travelPreferences = travelIntelligence.normalizeTravelPreferences(
      notificationResult.data ?? notificationsServer.DEFAULT_PREFS,
    );

    const profiles = (profileResult.data ?? []) as unknown as Prefs[];
    const profileById = new Map(profiles.map((p) => [p.id, p]));
    const defaultProfile = profiles[0];
    const assignments = (assignmentResult.data ?? []) as ProfileAssignment[];
    const fallbackPrefs: Prefs = {
      id: "",
      name: "Default",
      work_start: "09:00",
      work_end: "18:00",
      default_meeting_min: 30,
      break_every_min: 90,
      break_length_min: 10,
      lunch_at: "12:30",
      lunch_length_min: 45,
      notes: null,
    };

    const resolveLocal = (day: string, hhmm: string) => zonedInstant(timeZone, day, hhmm);

    const days: ForecastDayInput[] = dates.map(({ date, offsetMinutes, startMs, endMs }) => {
      const assignedId = resolveProfileIdForDate(assignments, date);
      const prefs =
        (assignedId ? profileById.get(assignedId) : undefined) ?? defaultProfile ?? fallbackPrefs;
      // Membership by overlap; computeGaps clips whatever crosses the boundary.
      const dayEvents = schedule.filter((event) =>
        overlapsRange(event, startMs, endMs, prefs.default_meeting_min),
      );
      const busy = tasksServer.buildPlannerBusyIntervals(
        dayEvents,
        travelPreferences,
        prefs.default_meeting_min,
      );
      const gaps = tasksServer.computeGaps(date, prefs, busy, nowMs, offsetMinutes, resolveLocal);
      const workingMinutes = minutesBetween(prefs.work_start, prefs.work_end);
      const capacity = gaps.reduce((sum, g) => sum + Math.round((g.end - g.start) / 60000), 0);
      return {
        date,
        offsetMinutes,
        gaps,
        breakMinutes: Math.max(0, prefs.break_length_min ?? 0),
        workingMinutes,
        committedMinutes: Math.max(0, workingMinutes - capacity),
        profileName: prefs.name,
      };
    });

    const blocks = new Map((taskBlockResult.data ?? []).map((row) => [row.id, row]));
    const tasks: ForecastTask[] = (tasksResult.data ?? []).map((row) => {
      const block = row.scheduled_appointment_id
        ? blocks.get(row.scheduled_appointment_id)
        : undefined;
      return {
        id: row.id,
        title: row.title,
        estimatedMin: row.estimated_min ?? 30,
        priority: row.priority ?? 2,
        deadline: row.deadline ?? null,
        status: row.status,
        createdAt: row.created_at,
        scheduledStart: block?.starts_at ?? null,
        scheduledEnd: block?.ends_at ?? null,
      };
    });

    return buildCapacityForecast({ nowMs, timeZone, days, tasks });
  });

function minutesBetween(startHhmm: string, endHhmm: string) {
  const toMin = (value: string) => {
    const [h, m] = value.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  return Math.max(0, toMin(endHhmm) - toMin(startHhmm));
}
