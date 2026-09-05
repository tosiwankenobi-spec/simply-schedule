import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { summarizeWelcomeProgress, type WelcomeProgress } from "./welcome-progress";

export const getWelcomeProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WelcomeProgress> => {
    const [profiles, calendarSyncs, importedCalendarEvents, tasks] = await Promise.all([
      context.supabase
        .from("planner_profiles")
        .select("id", { count: "exact", head: true })
        .eq("user_id", context.userId),
      context.supabase
        .from("sync_state")
        .select("id", { count: "exact", head: true })
        .eq("user_id", context.userId)
        .not("last_synced_at", "is", null),
      context.supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("user_id", context.userId)
        .in("source", ["google_calendar", "calendar_import"]),
      context.supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("user_id", context.userId),
    ]);

    const failure = [profiles.error, calendarSyncs.error, importedCalendarEvents.error, tasks.error]
      .filter(Boolean)
      .map((error) => error?.message)
      .join("; ");
    if (failure) throw new Error(failure);

    return summarizeWelcomeProgress({
      profileCount: profiles.count ?? 0,
      calendarSyncCount: calendarSyncs.count ?? 0,
      importedCalendarEventCount: importedCalendarEvents.count ?? 0,
      taskCount: tasks.count ?? 0,
    });
  });
