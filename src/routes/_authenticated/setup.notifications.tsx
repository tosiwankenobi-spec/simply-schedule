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
import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import { toast } from "sonner";
import { BellRing, Brain, CarFront, Mail, Send, ShieldCheck, X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/setup/notifications")({
  component: NotificationSetup,
  head: () => ({
    meta: [
      { title: "Reminders · Chronos-V" },
      {
        name: "description",
        content:
          "Choose how far ahead Chronos-V warns you about appointments, overdue tasks and unscheduled work.",
      },
      { property: "og:title", content: "Reminders · Chronos-V" },
      {
        property: "og:description",
        content: "Customise lead times, quiet hours and reminder channels.",
      },
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

  if (!form) {
    return (
      <div className="verolane-wash min-h-screen bg-background px-4 py-8">
        <div className="mx-auto max-w-[1180px] rounded-2xl border bg-card/80 py-16 text-center text-sm text-muted-foreground">
          Loading reminder preferences…
        </div>
      </div>
    );
  }

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
      qc.invalidateQueries({ queryKey: ["adaptive-reminder-preview"] });
      qc.invalidateQueries({ queryKey: ["next-travel-guidance"] });
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
        toast("Chronos-V test reminder", {
          description: "Device notifications are blocked — shown in-app instead.",
        });
      }
      const res = await sendTestNotification({});
      if (res.emailError) toast.error(res.emailError);
      else if (form.email_enabled) toast.success("Test email sent.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed.");
    }
  };

  return (
    <div className="verolane-wash relative min-h-screen bg-background">
      <div className="pointer-events-none absolute inset-0 paper-grain opacity-20" />
      <div className="relative mx-auto max-w-[1180px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <WorkspaceHeader
          eyebrow="Adaptive reminders"
          title={
            <>
              Be ready at the <span className="text-accent italic">right moment.</span>
            </>
          }
          description="Choose how Chronos-V prepares you for appointments, travel, deadlines, and unfinished work without interrupting quiet hours."
          action={
            <>
              <Button variant="outline" onClick={test} className="bg-card/80">
                <Send className="mr-1.5 h-4 w-4" /> Send a test
              </Button>
              <Button onClick={save} disabled={saving}>
                <BellRing className="mr-1.5 h-4 w-4" />
                {saving ? "Saving…" : "Save settings"}
              </Button>
            </>
          }
        />

        <div className="mt-8 grid items-start gap-6 xl:grid-cols-2">
          <div className="space-y-6">
            <section className="space-y-4 rounded-2xl border border-border bg-card/90 p-5 shadow-[0_18px_45px_rgba(0,46,40,0.04)] sm:p-6">
              <h2 className="font-serif text-2xl">Channels</h2>
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
              {form.email_enabled ? (
                <div className="space-y-1.5 rounded-xl bg-secondary/30 p-4">
                  <Label htmlFor="email_to">Send to</Label>
                  <Input
                    id="email_to"
                    type="email"
                    placeholder="Defaults to your account email"
                    value={form.email_to ?? ""}
                    onChange={(e) => set("email_to", e.target.value || null)}
                  />
                  <Button asChild variant="link" className="h-auto p-0 text-xs">
                    <Link to="/setup/gmail">
                      <Mail className="mr-1.5 h-3.5 w-3.5" /> Manage email connection
                    </Link>
                  </Button>
                </div>
              ) : null}
            </section>

            <section className="space-y-4 rounded-2xl border border-border bg-card/90 p-5 shadow-[0_18px_45px_rgba(0,46,40,0.04)] sm:p-6">
              <h2 className="font-serif text-2xl">Appointment lead times</h2>
              <p className="text-sm text-muted-foreground">
                You get one reminder per lead time before each appointment. Pick as many as you
                like, up to six.
              </p>
              <div className="flex flex-wrap gap-2">
                {[...new Set([...LEAD_PRESETS, ...form.appointment_lead_min])]
                  .sort((a, b) => a - b)
                  .map((m) => {
                    const on = form.appointment_lead_min.includes(m);
                    return (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleLead(m)}
                        className={`rounded-full border px-3 py-1.5 text-sm transition ${
                          on
                            ? "border-accent bg-accent text-accent-foreground"
                            : "border-border bg-background text-muted-foreground hover:border-foreground/40"
                        }`}
                      >
                        {leadLabel(m)}
                        {on ? <X className="ml-1 inline h-3 w-3" /> : null}
                      </button>
                    );
                  })}
              </div>
              <div className="flex flex-wrap items-end gap-2">
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
                <Button variant="outline" onClick={addCustom}>
                  Add
                </Button>
              </div>
            </section>

            <section className="space-y-4 rounded-2xl border border-border bg-card/90 p-5 shadow-[0_18px_45px_rgba(0,46,40,0.04)] sm:p-6">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-secondary p-2.5 text-accent">
                  <Brain className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-serif text-2xl">Adaptive timing</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Chronos-V adds a close reminder for online meetings, a leave-now reminder based
                    on your travel plan, and an evening-before prompt for fixed commitments that may
                    need preparation.
                  </p>
                </div>
              </div>

              {adaptivePreview.isLoading ? (
                <p className="text-sm text-muted-foreground">Checking your upcoming schedule…</p>
              ) : null}
              {adaptivePreview.data && adaptivePreview.data.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Upcoming adaptive reminders
                  </p>
                  {adaptivePreview.data.map((appointment) => (
                    <div
                      key={appointment.id}
                      className="rounded-xl border border-border bg-background p-4"
                    >
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
                            <span className="font-medium text-foreground">{signal.label}:</span>{" "}
                            {signal.reason}
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

              <PrivacyNote>
                This uses only details from your own appointments. The rules run inside Chronos-V;
                no schedule details are sent to a mapping or AI service.
              </PrivacyNote>
            </section>
          </div>

          <div className="space-y-6">
            <section className="space-y-4 rounded-2xl border border-border bg-card/90 p-5 shadow-[0_18px_45px_rgba(0,46,40,0.04)] sm:p-6">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-secondary p-2.5 text-accent">
                  <CarFront className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-serif text-2xl">Travel timing</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Chronos-V subtracts travel, a safety buffer, and preparation time from the
                    appointment start to calculate when you should get ready and leave.
                  </p>
                </div>
              </div>

              <Row
                label="Leave-now reminders"
                hint="Alert at the calculated leave-by time for appointments with a physical location."
                checked={form.travel_reminders_enabled}
                onChange={(value) => set("travel_reminders_enabled", value)}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="travel-mode">Usual travel mode</Label>
                  <select
                    id="travel-mode"
                    value={form.travel_mode}
                    onChange={(event) =>
                      set("travel_mode", event.target.value as NotifPrefs["travel_mode"])
                    }
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <option value="driving">Driving</option>
                    <option value="transit">Public transit</option>
                    <option value="walking">Walking</option>
                    <option value="cycling">Cycling</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="travel-minutes">Usual travel time (minutes)</Label>
                  <Input
                    id="travel-minutes"
                    type="number"
                    min={1}
                    max={240}
                    value={form.default_travel_min}
                    onChange={(event) =>
                      set(
                        "default_travel_min",
                        Math.min(240, Math.max(1, Number(event.target.value) || 1)),
                      )
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="travel-buffer">Safety buffer (minutes)</Label>
                  <Input
                    id="travel-buffer"
                    type="number"
                    min={0}
                    max={120}
                    value={form.travel_buffer_min}
                    onChange={(event) =>
                      set(
                        "travel_buffer_min",
                        Math.min(120, Math.max(0, Number(event.target.value) || 0)),
                      )
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="prep-minutes">Get-ready time (minutes)</Label>
                  <Input
                    id="prep-minutes"
                    type="number"
                    min={0}
                    max={240}
                    value={form.default_prep_min}
                    onChange={(event) =>
                      set(
                        "default_prep_min",
                        Math.min(240, Math.max(0, Number(event.target.value) || 0)),
                      )
                    }
                  />
                </div>
              </div>

              <PrivacyNote>
                These are estimates you control. Chronos-V does not send appointment locations to a
                mapping provider. You can override the next trip from Today.
              </PrivacyNote>
            </section>

            <section className="space-y-4 rounded-2xl border border-border bg-card/90 p-5 shadow-[0_18px_45px_rgba(0,46,40,0.04)] sm:p-6">
              <h2 className="font-serif text-2xl">Tasks</h2>
              <Row
                label="Overdue task reminders"
                hint="One reminder per overdue task, once a day."
                checked={form.overdue_tasks_enabled}
                onChange={(v) => set("overdue_tasks_enabled", v)}
              />
              {form.overdue_tasks_enabled ? (
                <div className="space-y-1.5 rounded-xl bg-secondary/30 p-4">
                  <Label htmlFor="grace">Grace period after the deadline (minutes)</Label>
                  <Input
                    id="grace"
                    inputMode="numeric"
                    value={String(form.overdue_grace_min)}
                    onChange={(e) =>
                      set("overdue_grace_min", Math.max(0, Number(e.target.value) || 0))
                    }
                    className="w-32"
                  />
                </div>
              ) : null}
              <Row
                label="Nudge until everything is scheduled"
                hint="Repeats while open tasks have no time block, most urgent first."
                checked={form.nudge_enabled}
                onChange={(v) => set("nudge_enabled", v)}
              />
              {form.nudge_enabled ? (
                <div className="space-y-1.5 rounded-xl bg-secondary/30 p-4">
                  <Label htmlFor="interval">Nudge every (minutes)</Label>
                  <Input
                    id="interval"
                    inputMode="numeric"
                    value={String(form.nudge_interval_min)}
                    onChange={(e) =>
                      set(
                        "nudge_interval_min",
                        Math.min(1440, Math.max(15, Number(e.target.value) || 120)),
                      )
                    }
                    className="w-32"
                  />
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl bg-ink p-5 text-paper shadow-[0_24px_55px_rgba(0,46,40,0.14)] sm:p-6">
              <h2 className="font-serif text-2xl">Quiet hours</h2>
              <p className="mt-1 text-sm text-paper/65">Nothing is sent between these times.</p>
              <div className="mt-5 flex flex-wrap gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="qs" className="text-paper/75">
                    From
                  </Label>
                  <Input
                    id="qs"
                    type="time"
                    value={form.quiet_start}
                    onChange={(e) => set("quiet_start", e.target.value)}
                    className="w-36 border-paper/20 bg-paper/10 text-paper"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="qe" className="text-paper/75">
                    Until
                  </Label>
                  <Input
                    id="qe"
                    type="time"
                    value={form.quiet_end}
                    onChange={(e) => set("quiet_end", e.target.value)}
                    className="w-36 border-paper/20 bg-paper/10 text-paper"
                  />
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function PrivacyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{children}</p>
    </div>
  );
}

function Row({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const controlId = `notification-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const hintId = `${controlId}-hint`;

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={controlId} className="text-sm font-medium">
          {label}
        </Label>
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      </div>
      <Switch
        id={controlId}
        checked={checked}
        aria-describedby={hintId}
        onCheckedChange={onChange}
      />
    </div>
  );
}
