import { createHash } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { CalendarImportKind } from "@/lib/calendar-import";

const kindSchema = z.enum(["outlook", "device"]);
const eventSchema = z.object({
  uid: z.string().min(1).max(500),
  occurrenceKey: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).nullable(),
  location: z.string().max(200).nullable(),
  notes: z.string().max(1000).nullable(),
  timezone: z.string().min(1).max(100),
  isAllDay: z.boolean(),
  recurrenceRule: z.string().max(1000).nullable(),
});

const importSchema = z.object({
  kind: kindSchema,
  calendarName: z.string().trim().min(1).max(120),
  events: z.array(eventSchema).min(1).max(500),
});

const deleteSchema = z.object({
  kind: kindSchema,
  calendarName: z.string().trim().min(1).max(120),
});

export type CalendarImportSummary = {
  kind: CalendarImportKind;
  calendarName: string;
  count: number;
  firstEventAt: string;
  lastEventAt: string;
  importedAt: string | null;
};

function providerFor(kind: CalendarImportKind) {
  return kind === "outlook" ? "outlook_calendar" : "device_calendar";
}

function externalId(
  userId: string,
  kind: CalendarImportKind,
  calendarName: string,
  uid: string,
  occurrence: string,
) {
  const digest = createHash("sha256")
    .update(`${userId}\0${kind}\0${calendarName}\0${uid}\0${occurrence}`)
    .digest("hex");
  return `calendar-import:${kind}:${digest}`;
}

export const importCalendarEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => importSchema.parse(input))
  .handler(async ({ data, context }) => {
    const provider = providerFor(data.kind);
    const importedAt = new Date().toISOString();
    let imported = 0;

    for (let offset = 0; offset < data.events.length; offset += 100) {
      const rows = data.events.slice(offset, offset + 100).map((event) => ({
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
        provider,
        calendar_id: data.calendarName,
        recurrence_rule: event.recurrenceRule,
        source: "calendar_import",
        external_id: externalId(
          context.userId,
          data.kind,
          data.calendarName,
          event.uid,
          event.occurrenceKey,
        ),
        last_synced_at: importedAt,
      }));
      const { data: saved, error } = await context.supabase
        .from("appointments")
        .upsert(rows, { onConflict: "user_id,external_id" })
        .select("id");
      if (error) throw error;
      imported += saved?.length ?? 0;
    }

    return { imported, calendarName: data.calendarName, kind: data.kind };
  });

export const getCalendarImports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CalendarImportSummary[]> => {
    const { data, error } = await context.supabase
      .from("appointments")
      .select("provider,calendar_id,starts_at,last_synced_at")
      .eq("user_id", context.userId)
      .eq("source", "calendar_import")
      .order("starts_at");
    if (error) throw error;

    const groups = new Map<string, CalendarImportSummary>();
    for (const row of data ?? []) {
      const kind: CalendarImportKind = row.provider === "outlook_calendar" ? "outlook" : "device";
      const name = row.calendar_id ?? "Imported calendar";
      const key = `${kind}\0${name}`;
      const current = groups.get(key);
      if (!current) {
        groups.set(key, {
          kind,
          calendarName: name,
          count: 1,
          firstEventAt: row.starts_at,
          lastEventAt: row.starts_at,
          importedAt: row.last_synced_at,
        });
        continue;
      }
      current.count++;
      current.lastEventAt = row.starts_at;
      if (row.last_synced_at && (!current.importedAt || row.last_synced_at > current.importedAt)) {
        current.importedAt = row.last_synced_at;
      }
    }
    return [...groups.values()].sort((a, b) => a.calendarName.localeCompare(b.calendarName));
  });

export const deleteCalendarImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => deleteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: removed, error } = await context.supabase
      .from("appointments")
      .delete()
      .eq("user_id", context.userId)
      .eq("source", "calendar_import")
      .eq("provider", providerFor(data.kind))
      .eq("calendar_id", data.calendarName)
      .select("id");
    if (error) throw error;
    return { removed: removed?.length ?? 0 };
  });
