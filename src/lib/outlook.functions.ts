/**
 * Authenticated server functions for per-user Microsoft Outlook sync.
 * Every function derives the user from the verified session — never from input.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { OUTLOOK_CONNECTOR_ID } from "./outlook";
import type {
  DisconnectOutcome,
  ExportCandidate,
  OutlookCalendar,
  OutlookStatus,
  OutlookSyncResult,
} from "./outlook.server";

export type {
  DisconnectOutcome,
  ExportCandidate,
  OutlookCalendar,
  OutlookStatus,
  OutlookSyncResult,
};

export const startOutlookConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ({
    native:
      typeof input === "object" && input !== null && "native" in input
        ? (input as { native?: unknown }).native === true
        : false,
  }))
  .handler(async ({ data, context }): Promise<{ authorizationUrl: string }> => {
    const { startOutlookConnectHandler } = await import("./outlook-connect.server");
    return startOutlookConnectHandler({ data, context });
  });

export const completeOutlookConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { code: string }) => {
    if (!input || typeof input.code !== "string" || !input.code.trim()) {
      throw new Error("Missing connection code.");
    }
    return { code: input.code };
  })
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { completeOutlookConnectHandler } = await import("./outlook-connect.server");
    return completeOutlookConnectHandler({ data, context });
  });

export const getOutlookStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OutlookStatus> => {
    const { readOutlookStatus } = await import("./outlook.server");
    return readOutlookStatus(context.supabase as never, context.userId);
  });

export const listOutlookCalendars = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OutlookCalendar[]> => {
    const { discoverCalendars } = await import("./outlook.server");
    return discoverCalendars(context.supabase as never, context.userId);
  });

export const selectOutlookCalendars = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { calendarIds: string[] }) => ({
    calendarIds: Array.isArray(input?.calendarIds)
      ? input.calendarIds.filter((id): id is string => typeof id === "string")
      : [],
  }))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { setSelectedCalendars } = await import("./outlook.server");
    await setSelectedCalendars(context.supabase as never, context.userId, data.calendarIds);
    return { ok: true };
  });

export const syncOutlookNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OutlookSyncResult> => {
    const { runOutlookSync } = await import("./outlook.server");
    return runOutlookSync(context.supabase as never, context.userId);
  });

/** Clears delta state so the next sync re-imports the full window. */
export const resetOutlookSyncState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OutlookSyncResult> => {
    const supabase = context.supabase as never as {
      from: (t: string) => {
        update: (p: unknown) => {
          eq: (c: string, v: string) => { like: (c: string, v: string) => Promise<unknown> };
        };
      };
    };
    await supabase
      .from("sync_state")
      .update({ sync_token: null, last_error: null })
      .eq("user_id", context.userId)
      .like("provider", "microsoft_outlook%");
    const { runOutlookSync } = await import("./outlook.server");
    return runOutlookSync(context.supabase as never, context.userId);
  });

export const disconnectOutlookAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DisconnectOutcome> => {
    const { disconnectOutlook } = await import("./outlook.server");
    return disconnectOutlook(context.supabase as never, context.userId);
  });

/** Per-user switch plus the calendar Chronos-V events are sent to. */
export const updateOutlookExportSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { enabled?: boolean; targetCalendarId?: string | null }) => ({
    ...(typeof input?.enabled === "boolean" ? { enabled: input.enabled } : {}),
    ...(input?.targetCalendarId === undefined
      ? {}
      : {
          targetCalendarId:
            typeof input.targetCalendarId === "string" ? input.targetCalendarId : null,
        }),
  }))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { setOutlookExportSettings } = await import("./outlook.server");
    await setOutlookExportSettings(context.supabase as never, context.userId, data);
    return { ok: true };
  });

/** Upcoming Chronos-V events offered for an explicit, per-event export. */
export const listOutlookExportCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ExportCandidate[]> => {
    const { listExportCandidates } = await import("./outlook.server");
    return listExportCandidates(context.supabase as never, context.userId);
  });

export const setOutlookEventExport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { appointmentId: string; shouldExport: boolean }) => {
    if (!input || typeof input.appointmentId !== "string" || !input.appointmentId) {
      throw new Error("Choose an event first.");
    }
    return { appointmentId: input.appointmentId, shouldExport: input.shouldExport === true };
  })
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { setAppointmentExport } = await import("./outlook.server");
    await setAppointmentExport(
      context.supabase as never,
      context.userId,
      data.appointmentId,
      data.shouldExport,
    );
    return { ok: true };
  });

/** Separate, explicitly confirmed destructive action. */
export const deleteOutlookLocalCopies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { confirm: string }) => {
    if (input?.confirm !== "DELETE") throw new Error("Deletion was not confirmed.");
    return input;
  })
  .handler(async ({ context }): Promise<{ removed: number }> => {
    const { deleteLocalOutlookCopies } = await import("./outlook.server");
    return deleteLocalOutlookCopies(context.supabase as never, context.userId);
  });
