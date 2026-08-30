import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { parseAppointmentWithAI, type ParsedAppointment } from "@/lib/appointments.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { AlertCircle, Check, Clock, Loader2, MapPin, Pencil, Sparkles, X } from "lucide-react";

export function QuickAddAppointment() {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ParsedAppointment | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  async function parse() {
    const value = text.trim();
    if (!value) return;
    if (!/\d|today|tomorrow|tonight|mon|tue|wed|thu|fri|sat|sun|next|noon|morning|afternoon|evening/i.test(value)) {
      setError("Add a day or time — e.g. “call mom tomorrow 6pm”.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const parsed = await parseAppointmentWithAI({ data: { text: value, now: new Date().toISOString() } });
      setDraft(parsed);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't understand that. Try adding a date and time.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("Not signed in");
      const { error: insErr } = await supabase.from("appointments").insert({
        title: draft.title.slice(0, 200),
        starts_at: draft.starts_at,
        ends_at: draft.ends_at,
        location: draft.location,
        notes: draft.notes,
        source: "quick_add",
        user_id: userData.user.id,
      } as never);
      if (insErr) throw insErr;
      qc.invalidateQueries({ queryKey: ["appointments"] });
      setDraft(null);
      setText("");
      toast.success("Added to your schedule");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  const startsLocal = draft ? toLocalInput(draft.starts_at) : "";
  const endsLocal = draft?.ends_at ? toLocalInput(draft.ends_at) : "";

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Sparkles className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-accent" />
          <Input
            value={text}
            onChange={(e) => { setText(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void parse(); } }}
            placeholder="lunch with Sam Thursday 1pm at Bar Vito"
            className="pl-9"
            aria-label="Quick add appointment"
            disabled={busy}
          />
        </div>
        <Button onClick={() => void parse()} disabled={busy || !text.trim()} className="bg-foreground text-background hover:bg-foreground/90">
          {busy ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Reading…</> : "Add"}
        </Button>
      </div>

      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      {draft && !editing && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/40 bg-background px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-serif text-base text-foreground">{draft.title}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {format(new Date(draft.starts_at), "EEE, MMM d · h:mm a")}
                {draft.ends_at ? ` – ${format(new Date(draft.ends_at), "h:mm a")}` : ""}
              </span>
              {draft.location && (
                <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {draft.location}</span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setDraft(null); }} aria-label="Discard">
              <X className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" disabled={saving} onClick={() => void save()} className="bg-accent text-accent-foreground hover:bg-accent/90">
              <Check className="h-3.5 w-3.5 mr-1" /> {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}

      {draft && editing && (
        <div className="mt-3 space-y-3 rounded-xl border border-border bg-background px-4 py-3">
          <div className="space-y-1.5">
            <Label htmlFor="qa-title">Title</Label>
            <Input id="qa-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="qa-start">Starts</Label>
              <Input
                id="qa-start"
                type="datetime-local"
                value={startsLocal}
                onChange={(e) => setDraft({ ...draft, starts_at: fromLocalInput(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qa-end">Ends</Label>
              <Input
                id="qa-end"
                type="datetime-local"
                value={endsLocal}
                onChange={(e) => setDraft({ ...draft, ends_at: e.target.value ? fromLocalInput(e.target.value) : null })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qa-loc">Location</Label>
            <Input
              id="qa-loc"
              value={draft.location ?? ""}
              onChange={(e) => setDraft({ ...draft, location: e.target.value || null })}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Done editing</Button>
            <Button size="sm" disabled={saving} onClick={() => void save()} className="bg-accent text-accent-foreground hover:bg-accent/90">
              <Check className="h-3.5 w-3.5 mr-1" /> {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

function fromLocalInput(local: string) {
  return new Date(local).toISOString();
}
