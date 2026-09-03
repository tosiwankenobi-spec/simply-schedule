import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getSettings, saveSettings } from "./calendar.server";

export type PrivacyProvider = "google_calendar" | "gmail";

export type PrivacyStatus = {
  calendar: {
    configured: boolean;
    enabled: boolean;
    selectedCalendars: number;
    importedItems: number;
    linkedItems: number;
    lastAccessedAt: string | null;
  };
  gmail: {
    configured: boolean;
    enabled: boolean;
    importedItems: number;
    lastAccessedAt: string | null;
  };
  chronos: {
    scheduleItems: number;
    tasks: number;
  };
};

type UserClient = SupabaseClient<Database>;
type SyncDetail = Database["public"]["Tables"]["sync_log"]["Row"]["detail"];
const READ_PAGE_SIZE = 1000;
const MUTATION_BATCH_SIZE = 100;

function collectGmailTaskIds(rows: Array<{ detail: SyncDetail }>, ids: Set<string>) {
  for (const row of rows) {
    if (!row.detail || typeof row.detail !== "object" || Array.isArray(row.detail)) continue;
    const taskId = (row.detail as Record<string, unknown>).taskId;
    if (
      typeof taskId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId)
    ) {
      ids.add(taskId);
    }
  }
}

async function readGmailTaskIds(supabase: UserClient, userId: string) {
  const ids = new Set<string>();
  for (let from = 0; ; from += READ_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("sync_log")
      .select("detail")
      .eq("user_id", userId)
      .eq("kind", "gmail_accepted_task")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + READ_PAGE_SIZE - 1);
    assertResult(error, "Couldn't read Gmail task history.");
    collectGmailTaskIds(data ?? [], ids);
    if ((data?.length ?? 0) < READ_PAGE_SIZE) break;
  }
  return [...ids];
}

function batches<T>(items: T[], size = MUTATION_BATCH_SIZE) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function assertResult(error: { message: string } | null, fallback: string) {
  if (error) throw new Error(error.message || fallback);
}

export async function readPrivacyStatus(
  supabase: UserClient,
  userId: string,
): Promise<PrivacyStatus> {
  const [
    settings,
    calendarImported,
    gmailImported,
    linked,
    schedule,
    tasks,
    calendarState,
    gmailState,
    gmailTaskIds,
  ] = await Promise.all([
    getSettings(supabase, userId),
    supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("source", "google_calendar"),
    supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("source", "gmail"),
    supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .not("calendar_event_id", "is", null),
    supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("user_id", userId),
    supabase
      .from("sync_state")
      .select("last_synced_at")
      .eq("user_id", userId)
      .like("provider", "google_calendar:%")
      .order("last_synced_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("sync_state")
      .select("last_synced_at")
      .eq("user_id", userId)
      .eq("provider", "google_mail")
      .maybeSingle(),
    readGmailTaskIds(supabase, userId),
  ]);

  const results = [
    calendarImported,
    gmailImported,
    linked,
    schedule,
    tasks,
    calendarState,
    gmailState,
  ];
  for (const result of results) assertResult(result.error, "Couldn't read privacy status.");

  let gmailTaskCount = 0;
  for (const taskIdBatch of batches(gmailTaskIds)) {
    const { count, error } = await supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("id", taskIdBatch);
    assertResult(error, "Couldn't count Gmail task suggestions.");
    gmailTaskCount += count ?? 0;
  }

  return {
    calendar: {
      configured: Boolean(process.env["GOOGLE_CALENDAR_API_KEY"]),
      enabled:
        Boolean(process.env["GOOGLE_CALENDAR_API_KEY"]) &&
        settings.selected_calendar_ids.length > 0,
      selectedCalendars: settings.selected_calendar_ids.length,
      importedItems: calendarImported.count ?? 0,
      linkedItems: linked.count ?? 0,
      lastAccessedAt: calendarState.data?.last_synced_at ?? null,
    },
    gmail: {
      configured: Boolean(process.env["GOOGLE_MAIL_API_KEY"]),
      enabled: Boolean(process.env["GOOGLE_MAIL_API_KEY"]) && settings.gmail_sync_enabled,
      importedItems: (gmailImported.count ?? 0) + gmailTaskCount,
      lastAccessedAt: gmailState.data?.last_synced_at ?? null,
    },
    chronos: {
      scheduleItems: schedule.count ?? 0,
      tasks: tasks.count ?? 0,
    },
  };
}

export async function setPrivacyProviderAccess(
  supabase: UserClient,
  userId: string,
  provider: PrivacyProvider,
  enabled: boolean,
) {
  if (provider === "google_calendar") {
    const current = await getSettings(supabase, userId);
    await saveSettings(supabase, userId, {
      auto_sync_enabled: enabled,
      selected_calendar_ids: enabled
        ? current.selected_calendar_ids.length > 0
          ? current.selected_calendar_ids
          : ["primary"]
        : [],
    });

    if (!enabled) {
      const [state, pending] = await Promise.all([
        supabase
          .from("sync_state")
          .delete()
          .eq("user_id", userId)
          .like("provider", "google_calendar:%"),
        supabase.from("pending_calendar_deletions").delete().eq("user_id", userId),
      ]);
      assertResult(state.error, "Couldn't clear calendar sync state.");
      assertResult(pending.error, "Couldn't clear pending calendar changes.");
    }
  } else {
    await saveSettings(supabase, userId, { gmail_sync_enabled: enabled });
    if (!enabled) {
      const { error } = await supabase
        .from("sync_state")
        .delete()
        .eq("user_id", userId)
        .eq("provider", "google_mail");
      assertResult(error, "Couldn't clear Gmail sync state.");
    }
  }

  return readPrivacyStatus(supabase, userId);
}

export async function deletePrivacyProviderData(
  supabase: UserClient,
  userId: string,
  provider: PrivacyProvider,
) {
  const source = provider === "google_calendar" ? "google_calendar" : "gmail";

  // Pause first so a background sync cannot immediately recreate the copies
  // the user is removing.
  if (provider === "google_calendar") {
    await saveSettings(supabase, userId, {
      auto_sync_enabled: false,
      selected_calendar_ids: [],
    });
  } else {
    await saveSettings(supabase, userId, { gmail_sync_enabled: false });
  }

  let removedGmailTasks = 0;
  if (provider === "gmail") {
    const taskIds = await readGmailTaskIds(supabase, userId);
    for (const taskIdBatch of batches(taskIds)) {
      const { data: taskRows, error: taskRowsError } = await supabase
        .from("tasks")
        .select("id,scheduled_appointment_id")
        .eq("user_id", userId)
        .in("id", taskIdBatch);
      assertResult(taskRowsError, "Couldn't read Gmail tasks.");
      const appointmentIds = (taskRows ?? [])
        .map((task) => task.scheduled_appointment_id)
        .filter((id): id is string => Boolean(id));
      if (appointmentIds.length > 0) {
        const { error: taskUnlinkError } = await supabase
          .from("appointments")
          .update({
            calendar_event_id: null,
            calendar_id: null,
            calendar_etag: null,
            last_synced_at: null,
            remote_updated_at: null,
          })
          .eq("user_id", userId)
          .in("id", appointmentIds);
        assertResult(taskUnlinkError, "Couldn't unlink Gmail task blocks.");
        const { error: blockError } = await supabase
          .from("appointments")
          .delete()
          .eq("user_id", userId)
          .in("id", appointmentIds);
        assertResult(blockError, "Couldn't delete Gmail task blocks.");
      }
      const { data: deletedTasks, error: taskDeleteError } = await supabase
        .from("tasks")
        .delete()
        .eq("user_id", userId)
        .in("id", taskIdBatch)
        .select("id");
      assertResult(taskDeleteError, "Couldn't delete Gmail tasks.");
      removedGmailTasks += deletedTasks?.length ?? 0;
    }
  }

  // Sever Google event links first. The appointments delete trigger only queues
  // a remote deletion when calendar_event_id is present, so this ordering keeps
  // the user's real Google Calendar untouched.
  const { error: unlinkError } = await supabase
    .from("appointments")
    .update({
      calendar_event_id: null,
      calendar_id: null,
      calendar_etag: null,
      last_synced_at: null,
      remote_updated_at: null,
    })
    .eq("user_id", userId)
    .eq("source", source);
  assertResult(unlinkError, "Couldn't unlink imported schedule items.");

  const { data: removed, error: removeError } = await supabase
    .from("appointments")
    .delete()
    .eq("user_id", userId)
    .eq("source", source)
    .select("id");
  assertResult(removeError, "Couldn't delete imported schedule items.");

  if (provider === "google_calendar") {
    const [state, pending] = await Promise.all([
      supabase
        .from("sync_state")
        .delete()
        .eq("user_id", userId)
        .like("provider", "google_calendar:%"),
      supabase.from("pending_calendar_deletions").delete().eq("user_id", userId),
    ]);
    assertResult(state.error, "Couldn't clear calendar sync state.");
    assertResult(pending.error, "Couldn't clear pending calendar changes.");
  } else {
    const [state, log] = await Promise.all([
      supabase.from("sync_state").delete().eq("user_id", userId).eq("provider", "google_mail"),
      supabase.from("sync_log").delete().eq("user_id", userId).like("kind", "gmail_%"),
    ]);
    assertResult(state.error, "Couldn't clear Gmail sync state.");
    assertResult(log.error, "Couldn't clear Gmail activity history.");
  }

  return { removed: (removed?.length ?? 0) + removedGmailTasks };
}
