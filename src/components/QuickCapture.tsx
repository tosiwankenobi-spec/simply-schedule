import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  confirmNaturalLanguageCapture,
  parseNaturalLanguageCapture,
  type CaptureDraft,
  type CaptureIntent,
} from "@/lib/capture.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  AlertCircle,
  CalendarClock,
  Check,
  Clock,
  ListTodo,
  Loader2,
  MapPin,
  Pencil,
  ShieldCheck,
  Sparkles,
  Timer,
  X,
} from "lucide-react";

const INTENT_LABEL: Record<CaptureIntent, string> = {
  appointment: "Appointment",
  task: "Task",
  scheduled_task: "Scheduled reminder",
  find_time: "Time found",
};

export function QuickCapture() {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<CaptureDraft | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const updateDraft = <K extends keyof CaptureDraft>(key: K, value: CaptureDraft[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  async function parse() {
    const value = text.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      const parsed = await parseNaturalLanguageCapture({
        data: {
          text: value,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          tzOffsetMin: new Date().getTimezoneOffset(),
        },
      });
      setDraft(parsed);
      setEditing(false);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Couldn't understand that. Try rephrasing it.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const result = await confirmNaturalLanguageCapture({ data: draft });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["appointments"] }),
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["day-replan-preview"] }),
      ]);
      setDraft(null);
      setText("");
      toast.success(
        result.kind === "appointment"
          ? "Appointment added to your schedule"
          : result.scheduled
            ? "Task added and scheduled"
            : "Task added to your list",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't save this item.");
    } finally {
      setSaving(false);
    }
  }

  const startsLocal = draft?.starts_at ? toLocalInput(draft.starts_at) : "";
  const endsLocal = draft?.ends_at ? toLocalInput(draft.ends_at) : "";
  const isTask = draft ? draft.intent !== "appointment" : false;

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-4">
      <div>
        <p className="font-serif text-base">Capture anything</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Add an appointment, make a task, set a reminder, or ask Chronos-V to find time.
        </p>
      </div>

      <div className="mt-3 flex gap-2">
        <div className="relative flex-1">
          <Sparkles className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-accent" />
          <Input
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void parse();
              }
            }}
            placeholder="Dentist Thursday at 2, or find 90 minutes this week for taxes"
            className="pl-9"
            aria-label="Natural-language schedule capture"
            disabled={busy}
          />
        </div>
        <Button
          onClick={() => void parse()}
          disabled={busy || !text.trim()}
          className="bg-foreground text-background hover:bg-foreground/90"
        >
          {busy ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Reading…
            </>
          ) : (
            "Review"
          )}
        </Button>
      </div>

      {error ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive" role="alert">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      ) : null}

      {draft && !editing ? (
        <div
          className="mt-3 rounded-xl border border-accent/40 bg-background px-4 py-3"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                {draft.intent === "appointment" ? (
                  <CalendarClock className="h-3 w-3" />
                ) : (
                  <ListTodo className="h-3 w-3" />
                )}
                {INTENT_LABEL[draft.intent]}
              </span>
              <p className="mt-1 truncate font-serif text-base text-foreground">{draft.title}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {draft.starts_at ? (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {format(new Date(draft.starts_at), "EEE, MMM d · h:mm a")}
                    {draft.ends_at ? ` – ${format(new Date(draft.ends_at), "h:mm a")}` : ""}
                  </span>
                ) : null}
                {isTask ? (
                  <span className="inline-flex items-center gap-1">
                    <Timer className="h-3 w-3" /> {draft.estimated_min} min
                  </span>
                ) : null}
                {draft.deadline ? <span>Due {draft.deadline}</span> : null}
                {draft.location ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> {draft.location}
                  </span>
                ) : null}
              </div>
              {draft.schedule_reason ? (
                <p className="mt-2 max-w-2xl text-xs text-muted-foreground">
                  {draft.schedule_reason}
                </p>
              ) : null}
              {draft.conflicts.length > 0 ? (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Conflicts with {draft.conflicts.join(", ")}. Check the time before confirming.
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDraft(null)}
                aria-label="Discard capture"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                disabled={saving}
                onClick={() => void save()}
                className="bg-accent text-accent-foreground hover:bg-accent/90"
              >
                <Check className="mr-1 h-3.5 w-3.5" /> {saving ? "Saving…" : "Confirm"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {draft && editing ? (
        <div className="mt-3 space-y-3 rounded-xl border border-border bg-background px-4 py-3">
          <div className="space-y-1.5">
            <Label htmlFor="capture-title">Title</Label>
            <Input
              id="capture-title"
              value={draft.title}
              onChange={(event) => updateDraft("title", event.target.value)}
            />
          </div>

          {isTask ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="capture-duration">Time needed (minutes)</Label>
                <Input
                  id="capture-duration"
                  type="number"
                  min={10}
                  max={480}
                  value={draft.estimated_min}
                  onChange={(event) => {
                    const minutes = Math.min(480, Math.max(10, Number(event.target.value) || 30));
                    updateDraft("estimated_min", minutes);
                    if (draft.starts_at) {
                      updateDraft(
                        "ends_at",
                        new Date(Date.parse(draft.starts_at) + minutes * 60000).toISOString(),
                      );
                    }
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="capture-deadline">Deadline</Label>
                <Input
                  id="capture-deadline"
                  type="date"
                  value={draft.deadline ?? ""}
                  onChange={(event) => updateDraft("deadline", event.target.value || null)}
                />
              </div>
            </div>
          ) : null}

          {draft.starts_at ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="capture-start">Starts</Label>
                <Input
                  id="capture-start"
                  type="datetime-local"
                  value={startsLocal}
                  onChange={(event) => updateDraft("starts_at", fromLocalInput(event.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="capture-end">Ends</Label>
                <Input
                  id="capture-end"
                  type="datetime-local"
                  value={endsLocal}
                  onChange={(event) =>
                    updateDraft(
                      "ends_at",
                      event.target.value ? fromLocalInput(event.target.value) : null,
                    )
                  }
                />
              </div>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="capture-location">Location or meeting link</Label>
            <Input
              id="capture-location"
              value={draft.location ?? ""}
              onChange={(event) => updateDraft("location", event.target.value || null)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="capture-notes">Notes</Label>
            <Textarea
              id="capture-notes"
              value={draft.notes ?? ""}
              onChange={(event) => updateDraft("notes", event.target.value || null)}
              rows={2}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Done editing
            </Button>
            <Button
              size="sm"
              disabled={saving || !draft.title.trim()}
              onClick={() => void save()}
              className="bg-accent text-accent-foreground hover:bg-accent/90"
            >
              <Check className="mr-1 h-3.5 w-3.5" /> {saving ? "Saving…" : "Confirm"}
            </Button>
          </div>
        </div>
      ) : null}

      <p className="mt-3 flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />
        Your text is sent to the connected AI service only to interpret this item. Nothing is saved
        until you confirm the preview.
      </p>
    </section>
  );
}

function toLocalInput(iso: string) {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalInput(local: string) {
  return new Date(local).toISOString();
}
