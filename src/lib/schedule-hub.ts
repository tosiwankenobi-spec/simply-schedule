import { useQuery } from "@tanstack/react-query";
import { isSameDay } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

/**
 * Shared schedule data layer.
 *
 * Every surface (Today, Tomorrow, Week) reads the same normalized model, backed by
 * the read-only `public.schedule_hub_events` view. Writes still go through the
 * `appointments` table.
 */

export type CommitmentType = "fixed" | "flexible";
export type SyncStatus = "synced" | "pending" | "local";
export type ScheduleProvider = "google_calendar" | "google_mail" | "chronos";

export type ScheduleEvent = {
  id: string;
  title: string;
  notes: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  is_all_day: boolean;
  commitment_type: CommitmentType;
  privacy_level: string;
  sync_status: SyncStatus;
  provider: ScheduleProvider;
  provider_account_id: string | null;
  calendar_id: string | null;
  calendar_event_id: string | null;
  recurrence_rule: string | null;
  source: string;
  source_label: string;
  duration_min: number;
  is_household_shared: boolean;
  shared_by_name: string | null;
  household_id: string | null;
  household_visibility: "private" | "busy" | "details";
};

/** Only non-private columns are requested — user_id and audit fields stay server-side. */
const COLUMNS = [
  "id",
  "title",
  "notes",
  "location",
  "starts_at",
  "ends_at",
  "timezone",
  "is_all_day",
  "commitment_type",
  "privacy_level",
  "sync_status",
  "provider",
  "provider_account_id",
  "calendar_id",
  "calendar_event_id",
  "recurrence_rule",
  "source",
  "source_label",
  "duration_min",
  "is_household_shared",
  "shared_by_name",
  "household_id",
  "household_visibility",
].join(",");

export const scheduleHubKey = ["appointments", "schedule-hub"] as const;

export async function fetchScheduleEvents(): Promise<ScheduleEvent[]> {
  const { data, error } = await supabase
    .from("schedule_hub_events")
    .select(COLUMNS)
    .order("starts_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ScheduleEvent[];
}

export function useScheduleEvents() {
  return useQuery({ queryKey: scheduleHubKey, queryFn: fetchScheduleEvents });
}

/** External calendar events are fixed: never move them silently from Chronos-V. */
export function isMovable(e: ScheduleEvent) {
  return !e.is_household_shared && e.commitment_type === "flexible" && !e.is_all_day;
}

export function eventStart(e: ScheduleEvent) {
  return new Date(e.starts_at);
}

export function eventEnd(e: ScheduleEvent) {
  return e.ends_at ? new Date(e.ends_at) : new Date(eventStart(e).getTime() + e.duration_min * 60000);
}

export function eventsOnDay(events: ScheduleEvent[], day: Date) {
  return events.filter((e) => isSameDay(eventStart(e), day));
}

export function upcomingEvents(events: ScheduleEvent[], from: Date) {
  return events.filter((e) => eventEnd(e) >= from);
}
