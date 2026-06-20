import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { format, addDays } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, SlidersHorizontal, Plus, Star, Trash2, CalendarRange } from "lucide-react";
import {
  listPlannerProfiles,
  upsertPlannerProfile,
  deletePlannerProfile,
  listPlannerAssignments,
  addPlannerAssignment,
  deletePlannerAssignment,
  type PlannerProfile,
} from "@/lib/planner.functions";

export const Route = createFileRoute("/_authenticated/planner/preferences")({
  component: PlannerPreferencesPage,
});

const BLANK: Omit<PlannerProfile, "id"> = {
  name: "",
  is_default: false,
  work_start: "09:00",
  work_end: "18:00",
  default_meeting_min: 30,
  break_every_min: 90,
  break_length_min: 10,
  lunch_at: "12:30",
  lunch_length_min: 45,
  notes: null,
};

function PlannerPreferencesPage() {
  const qc = useQueryClient();
  const { data: profiles, isLoading } = useQuery({
    queryKey: ["planner-profiles"],
    queryFn: () => listPlannerProfiles(),
  });
  const { data: assignments } = useQuery({
    queryKey: ["planner-assignments"],
    queryFn: () => listPlannerAssignments(),
  });

  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<PlannerProfile | (Omit<PlannerProfile, "id"> & { id?: undefined }) | null>(null);
  const [saving, setSaving] = useState(false);

  // Default selection: first profile
  useEffect(() => {
    if (profiles && selectedId === null) {
      setSelectedId(profiles[0]?.id ?? "new");
    }
  }, [profiles, selectedId]);

  useEffect(() => {
    if (selectedId === "new") setForm({ ...BLANK });
    else if (selectedId && profiles) {
      const p = profiles.find((x) => x.id === selectedId);
      if (p) setForm({ ...p });
    }
  }, [selectedId, profiles]);

  function set<K extends keyof PlannerProfile>(key: K, value: PlannerProfile[K]) {
    setForm((f) => (f ? { ...f, [key]: value } as PlannerProfile : f));
  }

  async function save() {
    if (!form) return;
    if (!form.name.trim()) { toast.error("Name your profile"); return; }
    setSaving(true);
    try {
      const saved = await upsertPlannerProfile({ data: {
        id: form.id,
        name: form.name.trim(),
        is_default: form.is_default,
        work_start: form.work_start,
        work_end: form.work_end,
        default_meeting_min: Number(form.default_meeting_min),
        break_every_min: Number(form.break_every_min),
        break_length_min: Number(form.break_length_min),
        lunch_at: form.lunch_at,
        lunch_length_min: Number(form.lunch_length_min),
        notes: form.notes ?? null,
      } });
      toast.success("Profile saved");
      await qc.invalidateQueries({ queryKey: ["planner-profiles"] });
      setSelectedId(saved.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    } finally { setSaving(false); }
  }

  async function remove() {
    if (!form?.id) return;
    if (!confirm(`Delete "${form.name}"?`)) return;
    try {
      await deletePlannerProfile({ data: { id: form.id } });
      toast.success("Profile deleted");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["planner-profiles"] }),
        qc.invalidateQueries({ queryKey: ["planner-assignments"] }),
      ]);
      setSelectedId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete");
    }
  }

  if (isLoading || !form) {
    return <div className="p-8 text-sm text-muted-foreground">Loading preferences…</div>;
  }

  return (
    <div className="relative min-h-screen bg-background">
      <div className="absolute inset-0 paper-grain opacity-30 pointer-events-none" />
      <div className="relative mx-auto max-w-3xl px-5 py-8 md:py-12">
        <Link to="/planner" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to planner
        </Link>

        <div className="mt-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1 text-xs text-accent">
            <SlidersHorizontal className="h-3 w-3" /> Planner preferences
          </div>
          <h1 className="mt-3 font-serif text-4xl md:text-5xl text-foreground leading-tight">
            Save many <span className="text-accent italic">rhythms</span>.
          </h1>
          <p className="mt-2 text-muted-foreground text-sm">
            Create profiles for different weeks (Focus, Meetings, Travel…), pick a default, and assign profiles to specific date ranges.
          </p>
        </div>

        <section className="mt-10 grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
          <aside className="space-y-1">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Profiles</h2>
              <button
                onClick={() => setSelectedId("new")}
                className="text-xs text-accent hover:underline inline-flex items-center"
              >
                <Plus className="h-3 w-3 mr-0.5" /> New
              </button>
            </div>
            <ul className="space-y-1">
              {(profiles ?? []).map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => setSelectedId(p.id)}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm border transition ${
                      selectedId === p.id ? "border-accent bg-accent/5" : "border-border hover:bg-secondary"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate">{p.name}</span>
                      {p.is_default && <Star className="h-3 w-3 text-accent fill-accent" />}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{p.work_start}–{p.work_end} · {p.default_meeting_min}m</span>
                  </button>
                </li>
              ))}
              {selectedId === "new" && (
                <li>
                  <div className="px-3 py-2 rounded-md text-sm border border-accent bg-accent/5">New profile…</div>
                </li>
              )}
            </ul>
          </aside>

          <div className="space-y-6 rounded-xl border border-border bg-card p-6">
            <Field label="Profile name">
              <Input value={form.name} maxLength={60} onChange={(e) => set("name", e.target.value)} placeholder="Focus week" />
            </Field>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!form.is_default}
                onChange={(e) => set("is_default", e.target.checked)}
              />
              Use as default profile
            </label>

            <section className="space-y-3">
              <h3 className="font-serif text-base">Working hours</h3>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start"><Input type="time" value={form.work_start} onChange={(e) => set("work_start", e.target.value)} /></Field>
                <Field label="End"><Input type="time" value={form.work_end} onChange={(e) => set("work_end", e.target.value)} /></Field>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="font-serif text-base">Meeting defaults</h3>
              <Field label="Default meeting / block length (minutes)">
                <Input type="number" min={5} max={480} value={form.default_meeting_min}
                  onChange={(e) => set("default_meeting_min", Number(e.target.value) || 30)} />
              </Field>
            </section>

            <section className="space-y-3">
              <h3 className="font-serif text-base">Breaks</h3>
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
              <h3 className="font-serif text-base">Lunch</h3>
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
              <h3 className="font-serif text-base">Extra constraints</h3>
              <Textarea rows={3} maxLength={1000} value={form.notes ?? ""}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="e.g. No meetings before 10am. Deep work in the morning. Gym Tue/Thu 6pm."
                className="resize-none" />
            </section>

            <div className="flex gap-2">
              <Button onClick={save} disabled={saving} className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90">
                {saving ? "Saving…" : form.id ? "Save changes" : "Create profile"}
              </Button>
              {form.id && (
                <Button variant="ghost" onClick={remove} className="text-destructive hover:text-destructive">
                  <Trash2 className="h-4 w-4 mr-1" /> Delete
                </Button>
              )}
            </div>
          </div>
        </section>

        <Assignments profiles={profiles ?? []} assignments={assignments ?? []} />
      </div>
    </div>
  );
}

function Assignments({ profiles, assignments }: { profiles: PlannerProfile[]; assignments: { id: string; profile_id: string; start_date: string; end_date: string }[] }) {
  const qc = useQueryClient();
  const [profileId, setProfileId] = useState<string>("");
  const [start, setStart] = useState(format(new Date(), "yyyy-MM-dd"));
  const [end, setEnd] = useState(format(addDays(new Date(), 6), "yyyy-MM-dd"));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!profileId && profiles[0]) setProfileId(profiles[0].id);
  }, [profiles, profileId]);

  const profileById = useMemo(() => {
    const m = new Map<string, PlannerProfile>();
    for (const p of profiles) m.set(p.id, p);
    return m;
  }, [profiles]);

  async function add() {
    if (!profileId) return;
    setBusy(true);
    try {
      await addPlannerAssignment({ data: { profile_id: profileId, start_date: start, end_date: end } });
      toast.success("Range assigned");
      await qc.invalidateQueries({ queryKey: ["planner-assignments"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't assign");
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    try {
      await deletePlannerAssignment({ data: { id } });
      await qc.invalidateQueries({ queryKey: ["planner-assignments"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't remove");
    }
  }

  return (
    <section className="mt-10 rounded-xl border border-border bg-card p-6">
      <h2 className="font-serif text-xl flex items-center gap-2">
        <CalendarRange className="h-4 w-4 text-accent" /> Date-range assignments
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Pick a profile for any date range. The AI planner uses the matching profile on each day; days with no match fall back to your default.
      </p>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-[1fr_140px_140px_auto] gap-2">
        <div className="space-y-1.5">
          <Label>Profile</Label>
          <Select value={profileId} onValueChange={setProfileId}>
            <SelectTrigger><SelectValue placeholder="Pick a profile" /></SelectTrigger>
            <SelectContent>
              {profiles.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}{p.is_default ? " (default)" : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Field label="Start"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="End"><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        <div className="flex items-end">
          <Button onClick={add} disabled={busy || !profileId} className="bg-foreground text-background hover:bg-foreground/90">
            <Plus className="h-4 w-4 mr-1" /> Assign
          </Button>
        </div>
      </div>

      <ul className="mt-6 space-y-2">
        {assignments.length === 0 && (
          <li className="text-sm text-muted-foreground">No assignments yet. Your default profile applies to every day.</li>
        )}
        {assignments.map((a) => {
          const p = profileById.get(a.profile_id);
          return (
            <li key={a.id} className="flex items-center justify-between border border-border rounded-md px-3 py-2">
              <div className="text-sm">
                <span className="font-medium">{p?.name ?? "Unknown"}</span>
                <span className="text-muted-foreground"> · {a.start_date} → {a.end_date}</span>
              </div>
              <button onClick={() => remove(a.id)} className="text-xs text-muted-foreground hover:text-destructive inline-flex items-center">
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove
              </button>
            </li>
          );
        })}
      </ul>
    </section>
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
