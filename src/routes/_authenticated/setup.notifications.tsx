import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  getNotificationPrefs,
  getAdaptiveReminderPreview,
  saveNotificationPrefs,
  sendTestNotification,
  type NotifPrefs,
} from "@/lib/notifications.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { ArrowLeft, BellRing, Brain, Mail, Send, ShieldCheck, X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/setup/notifications")({
  component: NotificationSetup,
  head: () => ({
    meta: [
      { title: "Reminders · Chronos-V" },
      {
        name: "description",
        content: "Choose how far ahead Chronos-V warns you about appointments, overdue tasks and unscheduled work.",
      },
      { property: "og:title", content: "Reminders · Chronos-V" },
      { property: "og:description", content: "Customise lead times, quiet hours and reminder channels." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const LEAD_PRESETS = [5, 10, 15, 30, 60, 120, 1440];

function leadLabel(min: number) {
  if (min >= 1440) return `${Math.round(min / 1440)} day`;
  if (min >= 60) return `${Math.round(min / 60)} hr`;
  return `${min} min`;
}

function NotificationSetup() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["notif-prefs"], queryFn: () => getNotificationPrefs() });
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const adaptivePreview = useQuery({
    queryKey: ["adaptive-reminder-preview", timeZone],
    queryFn: () => getAdaptiveReminderPreview({ data: { timeZone } }),
  });
  const [form, setForm] = useState<NotifPrefs | null>(null);
  const [saving, setSaving] = useState(false);
  const [customLead, setCustomLead] = useState("");

  useEffect(() => {
    if (data && !form) setForm(data);
  }, [data, form]);

  if (!form) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  const set = <K extends keyof NotifPrefs>(k: K, v: NotifPrefs[K]) => setForm({ ...form, [k]: v });

  const toggleLead = (min: number) => {
    const has = form.appointment_lead_min.includes(min);
    set(
      "appointment_lead_min",
      has
        ? form.appointment_lead_min.filter((m) => m !== min)
        : [...form.appointment_lead_min, min].sort((a, b) => b - a).slice(0, 6),
    );
  };

  const addCustom = () => {
    const n = Number(customLead);
    if (!Number.isFinite(n) || n < 1 || n > 10080) {
      toast.error("Enter a lead time between 1 and 10080 minutes.");
      return;
    }
    if (!form.appointment_lead_min.includes(n)) toggleLead(n);
    setCustomLead("");
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveNotificationPrefs({ data: { ...form, email_to: form.email_to ?? "" } });
      qc.invalidateQueries({ queryKey: ["notif-prefs"] });
      toast.success("Reminder settings saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    try {
      if ("Notification" in window && Notification.permission !== "granted") {
        await Notification.requestPermission();
      }
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("Chronos-V test reminder", { body: "Device notifications are working." });
      } else {
        toast("Chronos-V test reminder", { description: "Device notifications are blocked — shown in-app instead." });
      }
      const res = await sendTestNotification({});
      if (res.emailError) toast.error(res.emailError);
      else if (form.email_enabled) toast.success("Test email sent.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed.");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-5 py-10">
        <Link to="/app" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to schedule
        </Link>
        <h1 className="mt-4 font-serif text-3xl">Reminders</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Chronos-V checks for reminders every minute while the app is open, and delivers them as device
          notifications, email, or both.
        </p>

        <section className="mt-8 space-y-4 rounded-xl border border-border bg-card p-5">
          <h2 className="font-serif text-xl">Channels</h2>
          <Row
            label="Device notifications"
            hint="Pop-ups from your browser or installed app."
            checked={form.push_enabled}
            onChange={(v) => set("push_enabled", v)}
          />
          <Row
            label="Email reminders"
            hint="Sent through your connected Google account as a short digest."
            checked={form.email_enabled}
            onChange={(v) => set("email_enabled", v)}
          />
          {form.email_enabled && (
            <div className="space-y-1.5">
              <Label htmlFor="email_to">Send to</Label>
              <Input
                id="email_to"
                type="email"
                placeholder="Defaults to your account email"
                value={form.email_to ?? ""}
                onChange={(e) => set("email_to", e.target.value || null)}
                className="max-w-sm"
              />
            </div>
          )}
        </section>

        <section className="mt-6 space-y-4 rounded-xl border border-border bg-card p-5">
          <h2 className="font-serif text-xl">Appointment lead times</h2>
          <p className="text-sm text-muted-foreground">
            You get one reminder per lead time before each appointment. Pick as many as you like (up to 6).
          </p>
          <div className="flex flex-wrap gap-2">
            {[...new Set([...LEAD_PRESETS, ...form.appointment_lead_min])]
              .sort((a, b) => a - b)
              .map((m) => {
                const on = form.appointment_lead_min.includes(m);
                return (
                  <button
                    key={m}
                    onClick={() => toggleLead(m)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition ${
                      on ? "border-accent bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:border-foreground/40"
                    }`}
                  >
                    {leadLabel(m)}
                    {on && <X className="ml-1 inline h-3 w-3" />}
                  </button>
                );
              })}
          </div>
          <div className="flex items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="custom">Custom (minutes)</Label>
              <Input
                id="custom"
                inputMode="numeric"
                value={customLead}
                onChange={(e) => setCustomLead(e.target.value)}
                className="w-32"
                placeholder="45"
              />
            </div>
            <Button variant="outline" onClick={addCustom}>Add</Button>
          </div>
        </section>

        <section className="mt-6 space-y-4 rounded-xl border border-border bg-card p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-muted p-2">
              <Brain className="h-4 w-4" />
            </div>
            <div>
              <h2 className="font-serif text-xl">Adaptive timing</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Chronos-V adds a close reminder for online meetings, an earlier travel check for physical
                locations, and an evening-before prompt for fixed commitments that may need preparation.
              </p>
            </div>
          </div>

          {adaptivePreview.isLoading && (
            <p className="text-sm text-muted-foreground">Checking your upcoming schedule…</p>
          )}
          {adaptivePreview.data && adaptivePreview.data.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Upcoming adaptive reminders
              </p>
              {adaptivePreview.data.map((appointment) => (
                <div key={appointment.id} className="rounded-lg border border-border bg-background p-3">
                  <p className="text-sm font-medium">{appointment.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(appointment.starts_at).toLocaleString([], {
                      weekday: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {appointment.signals.map((signal) => (
                      <li key={signal.key} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{signal.label}:</span> {signal.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : adaptivePreview.isSuccess ? (
            <p className="text-sm text-muted-foreground">
              No upcoming appointments need adaptive timing in the next two weeks.
            </p>
          ) : null}

          <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              This uses only the title, time, location, notes, source, and commitment type from your own
              appointments. The rules run inside Chronos-V; no schedule details are sent to a mapping or AI
              service.
            </p>
          </div>
        </section>

        <section className="mt-6 space-y-4 rounded-xl border border-border bg-card p-5">
          <h2 className="font-serif text-xl">Tasks</h2>
          <Row
            label="Overdue task reminders"
            hint="One reminder per overdue task, once a day."
            checked={form.overdue_tasks_enabled}
            onChange={(v) => set("overdue_tasks_enabled", v)}
          />
          {form.overdue_tasks_enabled && (
            <div className="space-y-1.5">
              <Label htmlFor="grace">Grace period after the deadline (minutes)</Label>
              <Input
                id="grace"
                inputMode="numeric"
                value={String(form.overdue_grace_min)}
                onChange={(e) => set("overdue_grace_min", Math.max(0, Number(e.target.value) || 0))}
                className="w-32"
              />
            </div>
          )}
          <Row
            label="Nudge until everything is scheduled"
            hint="Repeats while open tasks have no time block, most urgent first."
            checked={form.nudge_enabled}
            onChange={(v) => set("nudge_enabled", v)}
          />
          {form.nudge_enabled && (
            <div className="space-y-1.5">
              <Label htmlFor="interval">Nudge every (minutes)</Label>
              <Input
                id="interval"
                inputMode="numeric"
                value={String(form.nudge_interval_min)}
                onChange={(e) => set("nudge_interval_min", Math.min(1440, Math.max(15, Number(e.target.value) || 120)))}
                className="w-32"
              />
            </div>
          )}
        </section>

        <section className="mt-6 space-y-4 rounded-xl border border-border bg-card p-5">
          <h2 className="font-serif text-xl">Quiet hours</h2>
          <p className="text-sm text-muted-foreground">Nothing is sent between these times.</p>
          <div className="flex flex-wrap gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="qs">From</Label>
              <Input id="qs" type="time" value={form.quiet_start} onChange={(e) => set("quiet_start", e.target.value)} className="w-36" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qe">Until</Label>
              <Input id="qe" type="time" value={form.quiet_end} onChange={(e) => set("quiet_end", e.target.value)} className="w-36" />
            </div>
          </div>
        </section>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={save} disabled={saving} className="bg-foreground text-background hover:bg-foreground/90">
            <BellRing className="h-4 w-4 mr-1.5" /> {saving ? "Saving…" : "Save settings"}
          </Button>
          <Button variant="outline" onClick={test}>
            <Send className="h-4 w-4 mr-1.5" /> Send a test
          </Button>
          <Button asChild variant="ghost">
            <Link to="/setup/gmail"><Mail className="h-4 w-4 mr-1.5" /> Email connection</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({
  label, hint, checked, onChange,
}: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
