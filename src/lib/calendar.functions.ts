import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SyncResult } from "./calendar.server";

export type { SyncResult };

export const syncGoogleCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SyncResult> => {
    const { runCalendarSync } = await import("./calendar.server");
    return runCalendarSync(context.supabase as never, context.userId);
  });

export const getSyncStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { readSyncStatus } = await import("./calendar.server");
    return readSyncStatus(context.supabase as never, context.userId);
  });
