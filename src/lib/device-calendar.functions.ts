import { createHash } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const eventSchema = z
  .object({
    nativeEventId: z.string().trim().min(1).max(500),
    occurrenceKey: z.string().datetime({ offset: true }),
    title: z.string().trim().min(1).max(200),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    location: z.string().max(200).nullable(),
    notes: z.string().max(1000).nullable(),
    timezone: z.string().min(1).max(100),
    isAllDay: z.boolean(),
  })
  .refine((event) => new Date(event.endsAt) > new Date(event.startsAt), {
    message: "Event end must be after its start.",
  });

const calendarSchema = z
  .object({
    calendarId: z.string().trim().min(1).max(300),
    calendarName: z.string().trim().min(1).max(120),
    events: z.array(eventSchema).max(500),
    truncated: z.boolean(),
  })
  .refine(
    (calendar) =>
      new Set(calendar.events.map((event) => `${event.nativeEventId}\0${event.occurrenceKey}`))
        .size === calendar.events.length,
    { message: "A calendar preview contains duplicate event occurrences." },
  );

const syncSchema = z
  .object({
    deviceId: z.string().trim().min(8).max(100),
    calendars: z.array(calendarSchema).min(1).max(10),
  })
  .refine(
    (input) =>
      new Set(input.calendars.map((calendar) => calendar.calendarId)).size ===
      input.calendars.length,
    { message: "Each selected device calendar must be unique." },
  );

const deviceSchema = z.object({ deviceId: z.string().trim().min(8).max(100) });

export type NativeDeviceCalendarStatus = {
  importedItems: number;
  calendars: Array<{
    calendarId: string;
    calendarName: string;
    count: number;
    lastRefreshedAt: string | null;
  }>;
};

function externalId(
  userId: string,
  deviceId: string,
  calendarId: string,
  nativeEventId: string,
  occurrenceKey: string,
) {
  const digest = createHash("sha256")
    .update(`${userId}\0${deviceId}\0${calendarId}\0${nativeEventId}\0${occurrenceKey}`)
    .digest("hex");
  return `device-calendar:${digest}`;
}

function assertSafeWindow(calendars: z.infer<typeof calendarSchema>[]) {
  const earliest = new Date();
  earliest.setDate(earliest.getDate() - 31);
  const latest = new Date();
  latest.setFullYear(latest.getFullYear() + 2);
  latest.setDate(latest.getDate() + 1);
  for (const calendar of calendars) {
    for (const event of calendar.events) {
      const startsAt = new Date(event.startsAt);
      if (startsAt < earliest || startsAt > latest) {
        throw new Error("A device event falls outside the supported import window.");
      }
    }
  }
}

export const syncNativeDeviceCalendars = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => syncSchema.parse(input))
  .handler(async ({ data, context }) => {
    assertSafeWindow(data.calendars);
    const refreshedAt = new Date().toISOString();
    let imported = 0;
    let removed = 0;

    for (const calendar of data.calendars) {
      const rows = calendar.events.map((event) => ({
        user_id: context.userId,
        title: event.title,
        starts_at: event.startsAt,
        ends_at: event.endsAt,
        location: event.location,
        notes: event.notes,
        timezone: event.timezone,
        is_all_day: event.isAllDay,
        commitment_type: "fixed",
        privacy_level: "private",
        sync_status: "local",
        provider: "device_calendar",
        provider_account_id: data.deviceId,
        calendar_id: calendar.calendarId,
        calendar_event_id: null,
        recurrence_rule: null,
        source: "calendar_import",
        source_metadata: {
          device_calendar_name: calendar.calendarName,
          imported_via: "native_read_only",
          native_event_id: event.nativeEventId,
        },
        external_id: externalId(
          context.userId,
          data.deviceId,
          calendar.calendarId,
          event.nativeEventId,
          event.occurrenceKey,
        ),
        last_synced_at: refreshedAt,
      }));
      const currentIds = rows.map((row) => row.external_id);

      for (let offset = 0; offset < rows.length; offset += 100) {
        const { data: saved, error } = await context.supabase
          .from("appointments")
          .upsert(rows.slice(offset, offset + 100), { onConflict: "user_id,external_id" })
          .select("id");
        if (error) throw error;
        imported += saved?.length ?? 0;
      }

      // A capped preview is incomplete, so it must never be treated as proof
      // that older copies disappeared from the device calendar.
      if (calendar.truncated) continue;

      const { data: existing, error: existingError } = await context.supabase
        .from("appointments")
        .select("id,external_id")
        .eq("user_id", context.userId)
        .eq("source", "calendar_import")
        .eq("provider", "device_calendar")
        .eq("provider_account_id", data.deviceId)
        .eq("calendar_id", calendar.calendarId);
      if (existingError) throw existingError;

      const current = new Set(currentIds);
      const staleIds = (existing ?? [])
        .filter((row) => row.external_id && !current.has(row.external_id))
        .map((row) => row.id);
      for (let offset = 0; offset < staleIds.length; offset += 100) {
        const { data: deleted, error } = await context.supabase
          .from("appointments")
          .delete()
          .eq("user_id", context.userId)
          .eq("source", "calendar_import")
          .eq("provider", "device_calendar")
          .eq("provider_account_id", data.deviceId)
          .in("id", staleIds.slice(offset, offset + 100))
          .select("id");
        if (error) throw error;
        removed += deleted?.length ?? 0;
      }
    }

    return { imported, removed, refreshedAt };
  });

export const getNativeDeviceCalendarStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => deviceSchema.parse(input))
  .handler(async ({ data, context }): Promise<NativeDeviceCalendarStatus> => {
    const { data: rows, error } = await context.supabase
      .from("appointments")
      .select("calendar_id,source_metadata,last_synced_at")
      .eq("user_id", context.userId)
      .eq("source", "calendar_import")
      .eq("provider", "device_calendar")
      .eq("provider_account_id", data.deviceId);
    if (error) throw error;

    const groups = new Map<string, NativeDeviceCalendarStatus["calendars"][number]>();
    for (const row of rows ?? []) {
      const calendarId = row.calendar_id ?? "unknown";
      const metadata =
        row.source_metadata &&
        typeof row.source_metadata === "object" &&
        !Array.isArray(row.source_metadata)
          ? row.source_metadata
          : {};
      if (metadata.imported_via !== "native_read_only") continue;
      const calendarName =
        typeof metadata.device_calendar_name === "string"
          ? metadata.device_calendar_name
          : "Device calendar";
      const current = groups.get(calendarId);
      if (!current) {
        groups.set(calendarId, {
          calendarId,
          calendarName,
          count: 1,
          lastRefreshedAt: row.last_synced_at,
        });
      } else {
        current.count++;
        if (
          row.last_synced_at &&
          (!current.lastRefreshedAt || row.last_synced_at > current.lastRefreshedAt)
        ) {
          current.lastRefreshedAt = row.last_synced_at;
        }
      }
    }
    const calendars = [...groups.values()].sort((a, b) =>
      a.calendarName.localeCompare(b.calendarName),
    );
    return {
      importedItems: calendars.reduce((count, calendar) => count + calendar.count, 0),
      calendars,
    };
  });

export const deleteNativeDeviceCalendarCopies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => deviceSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: removed, error } = await context.supabase
      .from("appointments")
      .delete()
      .eq("user_id", context.userId)
      .eq("source", "calendar_import")
      .eq("provider", "device_calendar")
      .eq("provider_account_id", data.deviceId)
      .select("id");
    if (error) throw error;
    return { removed: removed?.length ?? 0 };
  });
