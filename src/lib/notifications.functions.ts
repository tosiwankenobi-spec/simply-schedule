import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type {
  AdaptiveReminderPreview,
  NotifPrefs,
  PendingNotification,
} from "./notifications.server";

export type { AdaptiveReminderPreview, NotifPrefs, PendingNotification };

export const getNotificationPrefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<NotifPrefs> => {
    const { NOTIF_COLS, DEFAULT_PREFS } = await import("./notifications.server");
    const { data } = await context.supabase
      .from("notification_prefs")
      .select(NOTIF_COLS)
      .eq("user_id", context.userId)
      .maybeSingle();
    return (data as NotifPrefs | null) ?? DEFAULT_PREFS;
  });

const prefsSchema = z.object({
  push_enabled: z.boolean(),
  email_enabled: z.boolean(),
  email_to: z
    .string()
    .email()
    .nullable()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  appointment_lead_min: z.array(z.number().int().min(1).max(10080)).max(6),
  overdue_tasks_enabled: z.boolean(),
  overdue_grace_min: z.number().int().min(0).max(1440),
  nudge_enabled: z.boolean(),
  nudge_interval_min: z.number().int().min(15).max(1440),
  quiet_start: z.string().regex(/^\d{2}:\d{2}$/),
  quiet_end: z.string().regex(/^\d{2}:\d{2}$/),
  travel_reminders_enabled: z.boolean(),
  travel_mode: z.enum(["driving", "transit", "walking", "cycling", "other"]),
  default_travel_min: z.number().int().min(1).max(240),
  travel_buffer_min: z.number().int().min(0).max(120),
  default_prep_min: z.number().int().min(0).max(240),
});

export const saveNotificationPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => prefsSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("notification_prefs")
      .upsert({ ...data, user_id: context.userId }, { onConflict: "user_id" });
    if (error) throw error;
    return { ok: true };
  });

const adaptivePreviewSchema = z.object({
  timeZone: z.string().max(64).default("UTC"),
});

export const getAdaptiveReminderPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => adaptivePreviewSchema.parse(i))
  .handler(async ({ data, context }): Promise<AdaptiveReminderPreview[]> => {
    const { buildAdaptiveReminderPreview, NOTIF_COLS, DEFAULT_PREFS } =
      await import("./notifications.server");
    const now = new Date();
    const horizon = new Date(now.getTime() + 14 * 24 * 3600 * 1000);
    const [appointmentResult, preferenceResult] = await Promise.all([
      context.supabase
        .from("appointments")
        .select(
          "id,title,starts_at,location,notes,source,commitment_type,is_all_day,travel_minutes,preparation_minutes",
        )
        .eq("user_id", context.userId)
        .gte("starts_at", now.toISOString())
        .lte("starts_at", horizon.toISOString())
        .order("starts_at")
        .limit(20),
      context.supabase
        .from("notification_prefs")
        .select(NOTIF_COLS)
        .eq("user_id", context.userId)
        .maybeSingle(),
    ]);
    if (appointmentResult.error) throw appointmentResult.error;
    if (preferenceResult.error) throw preferenceResult.error;
    const preferences = (preferenceResult.data as NotifPrefs | null) ?? DEFAULT_PREFS;
    return buildAdaptiveReminderPreview(
      appointmentResult.data ?? [],
      data.timeZone,
      preferences,
    ).slice(0, 6);
  });

export type SweepResult = {
  /** Reminders created on this pass — the client shows these as device notifications. */
  fresh: { id: string; kind: string; title: string; body: string }[];
  /** Everything unseen, newest first, for the in-app bell. */
  unseen: { id: string; kind: string; title: string; body: string; created_at: string }[];
  emailError: string | null;
};

const sweepSchema = z.object({
  timeZone: z.string().max(64).default("UTC"),
  /** Local minutes past midnight on the client, used for quiet hours. */
  localMinutes: z.number().int().min(0).max(1439),
});

export const sweepNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => sweepSchema.parse(i))
  .handler(async ({ data, context }): Promise<SweepResult> => {
    const { NOTIF_COLS, DEFAULT_PREFS, buildDue, inQuietHours, sendEmail } =
      await import("./notifications.server");

    const { data: prefRow } = await context.supabase
      .from("notification_prefs")
      .select(NOTIF_COLS)
      .eq("user_id", context.userId)
      .maybeSingle();
    const prefs = (prefRow as NotifPrefs | null) ?? DEFAULT_PREFS;

    const now = Date.now();
    const longestLeadMinutes = Math.max(26 * 60, ...prefs.appointment_lead_min);
    const horizon = new Date(now + (longestLeadMinutes + 15) * 60000).toISOString();

    const [{ data: appts }, { data: tasks }, { data: lastNudge }] = await Promise.all([
      context.supabase
        .from("appointments")
        .select(
          "id,title,starts_at,location,notes,source,commitment_type,is_all_day,travel_minutes,preparation_minutes",
        )
        .eq("user_id", context.userId)
        .gte("starts_at", new Date(now - 60000).toISOString())
        .lte("starts_at", horizon)
        .order("starts_at")
        .limit(100),
      context.supabase
        .from("tasks")
        .select("id,title,deadline,priority,status")
        .eq("user_id", context.userId)
        .neq("status", "done")
        .limit(200),
      context.supabase
        .from("notification_log")
        .select("created_at")
        .eq("user_id", context.userId)
        .eq("kind", "nudge")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const fresh: SweepResult["fresh"] = [];
    let emailError: string | null = null;

    if (!inQuietHours(prefs, data.localMinutes)) {
      const due = buildDue({
        prefs,
        nowMs: now,
        timeZone: data.timeZone,
        appointments: appts ?? [],
        tasks: tasks ?? [],
        lastNudgeMs: lastNudge?.created_at ? Date.parse(lastNudge.created_at) : null,
      }).slice(0, 20); // bounded work per pass

      for (const n of due) {
        const channels = [
          ...(prefs.push_enabled ? ["push"] : []),
          ...(prefs.email_enabled ? ["email"] : []),
        ];
        if (channels.length === 0) continue;
        // Unique (user_id, dedupe_key) makes this idempotent across tabs and retries.
        const { data: inserted, error } = await context.supabase
          .from("notification_log")
          .insert({
            user_id: context.userId,
            kind: n.kind,
            dedupe_key: n.dedupe_key,
            title: n.title,
            body: n.body,
            channels,
          })
          .select("id,kind,title,body")
          .maybeSingle();
        if (error || !inserted) continue; // already delivered
        fresh.push(inserted);
      }

      if (prefs.email_enabled && fresh.length > 0) {
        const to = prefs.email_to ?? context.claims.email;
        if (!to) {
          emailError = "No email address set for reminders.";
        } else {
          const subject =
            fresh.length === 1 ? fresh[0]!.title : `${fresh.length} Chronos-V reminders`;
          const text = fresh.map((f) => `• ${f.title}\n  ${f.body}`).join("\n\n");
          emailError = await sendEmail(to, subject, text);
          if (!emailError) {
            await context.supabase
              .from("notification_log")
              .update({ emailed_at: new Date().toISOString() })
              .in(
                "id",
                fresh.map((f) => f.id),
              );
          }
        }
      }
    }

    const { data: unseen } = await context.supabase
      .from("notification_log")
      .select("id,kind,title,body,created_at")
      .eq("user_id", context.userId)
      .is("seen_at", null)
      .order("created_at", { ascending: false })
      .limit(30);

    return { fresh, unseen: unseen ?? [], emailError };
  });

export const markNotificationsSeen = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ ids: z.array(z.string().uuid()).max(50).optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("notification_log")
      .update({ seen_at: new Date().toISOString() })
      .eq("user_id", context.userId)
      .is("seen_at", null);
    if (data.ids && data.ids.length > 0) q = q.in("id", data.ids);
    const { error } = await q;
    if (error) throw error;
    return { ok: true };
  });

export const sendTestNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ emailError: string | null }> => {
    const { NOTIF_COLS, DEFAULT_PREFS, sendEmail } = await import("./notifications.server");
    const { data: prefRow } = await context.supabase
      .from("notification_prefs")
      .select(NOTIF_COLS)
      .eq("user_id", context.userId)
      .maybeSingle();
    const prefs = (prefRow as NotifPrefs | null) ?? DEFAULT_PREFS;
    if (!prefs.email_enabled) return { emailError: null };
    const to = prefs.email_to ?? context.claims.email;
    if (!to) return { emailError: "No email address set for reminders." };
    return {
      emailError: await sendEmail(
        to,
        "Chronos-V test reminder",
        "This is a test reminder. If you can read this, email notifications are working.",
      ),
    };
  });
