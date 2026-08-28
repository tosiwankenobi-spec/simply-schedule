import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SyncResult, SyncStatus, SyncSettings, CalendarOption, ConflictPolicy } from "./calendar.server";

export type { SyncResult, SyncStatus, SyncSettings, CalendarOption, ConflictPolicy };

export const syncGoogleCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SyncResult> => {
    const { runCalendarSync } = await import("./calendar.server");
    return runCalendarSync(context.supabase as never, context.userId);
  });

/** One-click recovery: clear stale tokens/errors, then run a full sync. */
export const reconnectCalendarSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SyncResult> => {
    const { runCalendarSync, resetSyncTokens } = await import("./calendar.server");
    await resetSyncTokens(context.supabase as never, context.userId);
    return runCalendarSync(context.supabase as never, context.userId);
  });


export const getSyncStatus = createServerFn({ method: "POST" }).handler(
  async (): Promise<SyncStatus> => {
    const { readSyncStatusSafe } = await import("./calendar.server");
    return readSyncStatusSafe();
  },
);

export const listGoogleCalendars = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CalendarOption[]> => {
    const { listCalendars } = await import("./calendar.server");
    return listCalendars(context.supabase as never, context.userId);
  });

export const saveSyncSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Partial<SyncSettings>) => input)
  .handler(async ({ data, context }): Promise<SyncSettings> => {
    const { saveSettings } = await import("./calendar.server");
    return saveSettings(context.supabase as never, context.userId, data);
  });

export const clearSyncLogEntries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { clearSyncLog } = await import("./calendar.server");
    return clearSyncLog(context.supabase as never, context.userId);
  });

export const resetCalendarSyncTokens = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { resetSyncTokens } = await import("./calendar.server");
    return resetSyncTokens(context.supabase as never, context.userId);
  });
