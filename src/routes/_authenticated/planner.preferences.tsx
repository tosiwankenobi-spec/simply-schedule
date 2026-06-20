import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ArrowLeft, SlidersHorizontal } from "lucide-react";
import { getPlannerPrefs, savePlannerPrefs, type PlannerPrefs } from "@/lib/planner.functions";

export const Route = createFileRoute("/_authenticated/planner/preferences")({
  component: PlannerPreferencesPage,
});

function PlannerPreferencesPage() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["planner-prefs"],
    queryFn: () => getPlannerPrefs(),
  });

  const [form, setForm] = useState<PlannerPrefs | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (data && !form) setForm(data); }, [data, form]);

  if (isLoading || !form) {
    return <div className="p-8 text-sm text-muted-foreground">Loading preferences…</div>;
  }

  function set<K extends keyof PlannerPrefs>(key: K, value: PlannerPrefs[K]) {
    setForm((f) => f ? { ...f, [key]: value } : f);
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      await savePlannerPrefs({ data: {
        work_start: form.work_start,
        work_end: form.work_end,
        default_meeting_min: Number(form.default_meeting_min),
        break_every_min: Number(form.break_every_min),
        break_length_min: Number(form.break_length_min),
        lunch_at: form.lunch_at,
        lunch_length_min: Number(form.lunch_length_min),
        notes: form.notes ?? null,
      } });
      toast.success("Preferences saved");
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    } finally { setSaving(false); }
  }

  return (
    <div className="relative min-h-screen bg-background">
      <div className="absolute inset-0 paper-grain opacity-30 pointer-events-none" />
      <div className="relative mx-auto max-w-2xl px-5 py-8 md:py-12">
        <Link to="/planner" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to planner
        </Link>

        <div className="mt-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1 text-xs text-accent">
            <SlidersHorizontal className="h-3 w-3" /> Planner preferences
          </div>
          <h1 className="mt-3 font-serif text-4xl md:text-5xl text-foreground leading-tight">
            Your <span className="text-accent italic">rhythm</span>.
          </h1>
          <p className="mt-2 text-muted-foreground text-sm">
            The AI planner uses these constraints whenever it builds your day, week, or quick tasks.
          </p>
        </div>

        <div className="mt-10 space-y-6 rounded-xl border border-border bg-card p-6">
          <section className="space-y-3">
            <h2 className="font-serif text-lg">Working hours</h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start"><Input type="time" value={form.work_start} onChange={(e) => set("work_start", e.target.value)} /></Field>
              <Field label="End"><Input type="time" value={form.work_end} onChange={(e) => set("work_end", e.target.value)} /></Field>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="font-serif text-lg">Meeting defaults</h2>
            <Field label="Default meeting / block length (minutes)">
              <Input type="number" min={5} max={480} value={form.default_meeting_min}
                onChange={(e) => set("default_meeting_min", Number(e.target.value) || 30)} />
            </Field>
          </section>

          <section className="space-y-3">
            <h2 className="font-serif text-lg">Breaks</h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Break every (min)">
                <Input type="number" min={15} max={480} value={form.break_every_min}
                  onChange={(e) => set("break_every_min", Number(e.target.value) || 90)} />
              </Field>
              <Field label="Break length (min)">
                <Input type="number" min={5} max={120} value={form.break_length_min}
                  onChange={(e) => set("break_length_min", Number(e.target.value) || 10)} />
              </Field>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="font-serif text-lg">Lunch</h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Lunch around"><Input type="time" value={form.lunch_at} onChange={(e) => set("lunch_at", e.target.value)} /></Field>
              <Field label="Lunch length (min)">
                <Input type="number" min={0} max={180} value={form.lunch_length_min}
                  onChange={(e) => set("lunch_length_min", Number(e.target.value) || 0)} />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">Set length to 0 to skip lunch.</p>
          </section>

          <section className="space-y-3">
            <h2 className="font-serif text-lg">Extra constraints</h2>
            <Textarea rows={3} maxLength={1000} value={form.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="e.g. No meetings before 10am. Deep work in the morning. Gym Tue/Thu 6pm."
              className="resize-none" />
          </section>

          <Button onClick={save} disabled={saving} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
            {saving ? "Saving…" : "Save preferences"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
