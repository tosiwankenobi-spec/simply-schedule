// Server-only helpers for reminder generation and email delivery.

export type NotifPrefs = {
  push_enabled: boolean;
  email_enabled: boolean;
  email_to: string | null;
  appointment_lead_min: number[];
  overdue_tasks_enabled: boolean;
  overdue_grace_min: number;
  nudge_enabled: boolean;
  nudge_interval_min: number;
  quiet_start: string;
  quiet_end: string;
};

export const NOTIF_COLS =
  "push_enabled,email_enabled,email_to,appointment_lead_min,overdue_tasks_enabled,overdue_grace_min,nudge_enabled,nudge_interval_min,quiet_start,quiet_end";

export const DEFAULT_PREFS: NotifPrefs = {
  push_enabled: true,
  email_enabled: false,
  email_to: null,
  appointment_lead_min: [60, 10],
  overdue_tasks_enabled: true,
  overdue_grace_min: 0,
  nudge_enabled: true,
  nudge_interval_min: 120,
  quiet_start: "21:00",
  quiet_end: "07:00",
};

function minutesOfDay(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Quiet hours may wrap past midnight (e.g. 21:00 → 07:00). */
export function inQuietHours(prefs: NotifPrefs, localMinutes: number) {
  const start = minutesOfDay(prefs.quiet_start);
  const end = minutesOfDay(prefs.quiet_end);
  if (start === end) return false;
  return start < end
    ? localMinutes >= start && localMinutes < end
    : localMinutes >= start || localMinutes < end;
}

export type PendingNotification = {
  kind: "appointment" | "overdue" | "nudge";
  dedupe_key: string;
  title: string;
  body: string;
};

function fmtTime(iso: string, tz: string) {
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
    });
  } catch {
    return new Date(iso).toISOString().slice(11, 16);
  }
}

/** Pure reminder computation — no IO, so it stays cheap and testable. */
export function buildDue(input: {
  prefs: NotifPrefs;
  nowMs: number;
  timeZone: string;
  appointments: { id: string; title: string; starts_at: string; location: string | null }[];
  tasks: { id: string; title: string; deadline: string | null; priority: number; status: string }[];
  lastNudgeMs: number | null;
}): PendingNotification[] {
  const { prefs, nowMs, timeZone } = input;
  const out: PendingNotification[] = [];

  // 1. Upcoming appointments, one reminder per configured lead time.
  const leads = [...new Set(prefs.appointment_lead_min)].filter((n) => n > 0).sort((a, b) => b - a);
  for (const appt of input.appointments) {
    const startMs = Date.parse(appt.starts_at);
    if (!Number.isFinite(startMs)) continue;
    for (const lead of leads) {
      const fireAt = startMs - lead * 60000;
      // Fire inside a 15-minute window so a missed poll still delivers.
      if (nowMs >= fireAt && nowMs < fireAt + 15 * 60000 && nowMs < startMs) {
        out.push({
          kind: "appointment",
          dedupe_key: `appt:${appt.id}:${lead}`,
          title: `In ${lead < 60 ? `${lead} min` : `${Math.round(lead / 60)} hr`}: ${appt.title}`,
          body: `${fmtTime(appt.starts_at, timeZone)}${appt.location ? ` · ${appt.location}` : ""}`,
        });
      }
    }
  }

  // 2. Overdue tasks — one reminder per task per day.
  if (prefs.overdue_tasks_enabled) {
    const todayKey = new Date(nowMs).toISOString().slice(0, 10);
    for (const t of input.tasks) {
      if (t.status === "done" || !t.deadline) continue;
      const dueMs = Date.parse(`${t.deadline}T23:59:59`) + prefs.overdue_grace_min * 60000;
      if (nowMs > dueMs) {
        out.push({
          kind: "overdue",
          dedupe_key: `overdue:${t.id}:${todayKey}`,
          title: `Overdue: ${t.title}`,
          body: `Was due ${t.deadline}. Schedule it or push the deadline.`,
        });
      }
    }
  }

  // 3. Escalating nudge until every task has a slot.
  if (prefs.nudge_enabled) {
    const unscheduled = input.tasks.filter((t) => t.status === "open");
    const dueSoon = unscheduled.filter(
      (t) => t.deadline && Date.parse(`${t.deadline}T23:59:59`) - nowMs < 48 * 3600 * 1000,
    );
    const intervalMs = Math.max(15, prefs.nudge_interval_min) * 60000;
    const ready = input.lastNudgeMs === null || nowMs - input.lastNudgeMs >= intervalMs;
    if (unscheduled.length > 0 && ready) {
      const ranked = [...unscheduled].sort((a, b) => {
        const ad = a.deadline ? Date.parse(a.deadline) : Number.POSITIVE_INFINITY;
        const bd = b.deadline ? Date.parse(b.deadline) : Number.POSITIVE_INFINITY;
        return ad !== bd ? ad - bd : a.priority - b.priority;
      });
      const top = ranked.slice(0, 3).map((t) => t.title);
      out.push({
        kind: "nudge",
        dedupe_key: `nudge:${Math.floor(nowMs / intervalMs)}`,
        title:
          dueSoon.length > 0
            ? `${dueSoon.length} urgent task${dueSoon.length === 1 ? "" : "s"} still unscheduled`
            : `${unscheduled.length} task${unscheduled.length === 1 ? "" : "s"} still unscheduled`,
        body: `Start with: ${top.join(", ")}${ranked.length > 3 ? `, +${ranked.length - 3} more` : ""}`,
      });
    }
  }

  return out;
}

const GMAIL_SEND = "https://connector-gateway.lovable.dev/google_mail/gmail/v1/users/me/messages/send";

function base64Url(input: string) {
  const bytes = new TextEncoder().encode(input);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = typeof btoa === "function" ? btoa(bin) : "";
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Sends one digest email through the linked Gmail connector. Returns null on success. */
export async function sendEmail(to: string, subject: string, text: string): Promise<string | null> {
  const lovableKey = process.env['LOVABLE_API_KEY'];
  const gmailKey = process.env['GOOGLE_MAIL_API_KEY'];
  if (!lovableKey || !gmailKey) return "Email is not connected yet.";

  const mime = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    text,
  ].join("\r\n");

  try {
    const res = await fetch(GMAIL_SEND, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": gmailKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: base64Url(mime) }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return `Email failed (${res.status}): ${body.slice(0, 160)}`;
    }
    return null;
  } catch (e) {
    return `Email failed: ${e instanceof Error ? e.message : "unknown error"}`;
  }
}
