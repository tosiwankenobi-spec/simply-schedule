import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { format } from "date-fns";
import {
  listTasks,
  upsertTask,
  setTaskStatus,
  deleteTask,
  autoScheduleTasks,
  type AutoScheduleResult,
} from "@/lib/tasks.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { WhyTheseBlocks } from "@/components/WhyTheseBlocks";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, Circle, Trash2, Wand2, Plus, Clock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/tasks")({
  component: TasksPage,
  head: () => ({
    meta: [
      { title: "Task backlog · Chronos-V" },
      { name: "description", content: "Capture tasks with priority, effort and deadlines, then let AI auto-schedule them into your free time." },
      { property: "og:title", content: "Task backlog · Chronos-V" },
      { property: "og:description", content: "Capture tasks and let AI auto-schedule them into your free time." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const PRIORITY_LABEL: Record<number, string> = { 1: "High", 2: "Normal", 3: "Low" };

function TasksPage() {
  const qc = useQueryClient();
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [preview, setPreview] = useState<AutoScheduleResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);


  const { data: tasks, isLoading } = useQuery({ queryKey: ["tasks"], queryFn: () => listTasks() });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["appointments"] });
  };

  const status = useMutation({
    mutationFn: (v: { id: string; status: "open" | "scheduled" | "done" }) => setTaskStatus({ data: v }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteTask({ data: { id } }),
    onSuccess: invalidate,
  });

  const taskIds = selected.length > 0 ? selected : undefined;

  async function runPreview() {
    setBusy(true);
    try {
      const res = await autoScheduleTasks({ data: { date, dryRun: true, taskIds, tzOffsetMin: new Date().getTimezoneOffset() } });
      setPreview(res);
      if (res.placements.length === 0) toast.message("No room in that day's free time for those tasks.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't build a plan");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    try {
      const res = await autoScheduleTasks({ data: { date, dryRun: false, taskIds, tzOffsetMin: new Date().getTimezoneOffset() } });
      setPreview(null);
      setSelected([]);
      invalidate();
      toast.success(`Scheduled ${res.placements.length} task${res.placements.length === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't apply the plan");
    } finally {
      setBusy(false);
    }
  }


  const open = (tasks ?? []).filter((t) => t.status === "open");
  const scheduled = (tasks ?? []).filter((t) => t.status === "scheduled");
  const done = (tasks ?? []).filter((t) => t.status === "done");

  return (
    <div className="relative min-h-screen bg-background">
      <div className="absolute inset-0 paper-grain opacity-30 pointer-events-none" />
      <div className="relative mx-auto max-w-2xl px-5 py-8 md:py-12">
        <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
          <Link to="/app"><ArrowLeft className="h-4 w-4 mr-1" /> Schedule</Link>
        </Button>

        <h1 className="mt-6 font-serif text-4xl text-foreground">Task backlog</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Capture what needs doing. The planner fits it into the gaps your profile allows.
        </p>

        <NewTaskForm onSaved={invalidate} />

        <section className="mt-10 rounded-xl border border-border bg-card p-5">
          <h2 className="font-serif text-xl">Smart scheduling</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick the tasks you want placed — or leave all unticked to consider the whole backlog. Blocks land in the
            free gaps inside your working hours, longest deadline pressure and highest priority first.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="asd">Day</Label>
              <Input id="asd" type="date" value={date} onChange={(e) => { setDate(e.target.value); setPreview(null); }} className="w-44" />
            </div>
            <Button onClick={runPreview} disabled={busy || open.length === 0} className="bg-accent text-accent-foreground hover:bg-accent/90">
              <Wand2 className="h-4 w-4 mr-1.5" /> {busy ? "Working…" : "Propose time blocks"}
            </Button>
          </div>

          {open.length > 0 && (
            <div className="mt-4">
              <div className="flex items-baseline justify-between">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Select tasks {selected.length > 0 ? `· ${selected.length}` : "· all"}
                </p>
                <button
                  className="text-xs text-muted-foreground underline"
                  onClick={() => { setSelected(selected.length === open.length ? [] : open.map((t) => t.id)); setPreview(null); }}
                >
                  {selected.length === open.length ? "Clear" : "Select all"}
                </button>
              </div>
              <ul className="mt-2 space-y-1.5">
                {open.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                    <Checkbox
                      id={`sel-${t.id}`}
                      checked={selected.includes(t.id)}
                      onCheckedChange={() => {
                        setPreview(null);
                        setSelected((s) => (s.includes(t.id) ? s.filter((x) => x !== t.id) : [...s, t.id]));
                      }}
                    />
                    <label htmlFor={`sel-${t.id}`} className="min-w-0 flex-1 cursor-pointer truncate text-sm">
                      {t.title}
                    </label>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t.estimated_min}m · {PRIORITY_LABEL[t.priority]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}


          {preview && (
            <div className="mt-5 space-y-3 border-t border-border pt-4">
              <p className="text-xs text-muted-foreground">Profile: {preview.profile}</p>
              <WhyTheseBlocks result={preview} />
              {preview.placements.length > 0 && (
                <ul className="space-y-1.5">
                  {preview.placements.map((p) => (
                    <li key={p.task_id} className="flex items-center justify-between text-sm">
                      <span className="truncate">{p.title}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {format(new Date(p.starts_at), "h:mm a")} – {format(new Date(p.ends_at), "h:mm a")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {preview.unplaced.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  No room for: {preview.unplaced.map((u) => u.title).join(", ")}
                </p>
              )}
              {preview.placements.length > 0 && (
                <div className="flex gap-2 pt-1">
                  <Button onClick={apply} disabled={busy} className="bg-foreground text-background hover:bg-foreground/90">
                    Apply to schedule
                  </Button>
                  <Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button>
                </div>
              )}
            </div>
          )}
        </section>

        <div className="mt-10 space-y-8">
          <TaskGroup title={`Open · ${open.length}`} items={open} onStatus={(id, s) => status.mutate({ id, status: s })} onDelete={(id) => remove.mutate(id)} loading={isLoading} />
          {scheduled.length > 0 && (
            <TaskGroup title={`Scheduled · ${scheduled.length}`} items={scheduled} onStatus={(id, s) => status.mutate({ id, status: s })} onDelete={(id) => remove.mutate(id)} />
          )}
          {done.length > 0 && (
            <TaskGroup title="Done" items={done} muted onStatus={(id, s) => status.mutate({ id, status: s })} onDelete={(id) => remove.mutate(id)} />
          )}
        </div>
      </div>
    </div>
  );
}

type Task = Awaited<ReturnType<typeof listTasks>>[number];

function TaskGroup({
  title, items, onStatus, onDelete, muted, loading,
}: {
  title: string;
  items: Task[];
  onStatus: (id: string, s: "open" | "scheduled" | "done") => void;
  onDelete: (id: string) => void;
  muted?: boolean;
  loading?: boolean;
}) {
  return (
    <div>
      <h3 className="mb-3 font-serif text-lg">{title}</h3>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
          Nothing here yet.
        </p>
      ) : (
        <ul className={`space-y-2 ${muted ? "opacity-60" : ""}`}>
          {items.map((t) => (
            <li key={t.id} className="group flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <button
                onClick={() => onStatus(t.id, t.status === "done" ? "open" : "done")}
                aria-label={t.status === "done" ? "Reopen task" : "Mark done"}
                className="mt-0.5 text-muted-foreground hover:text-accent"
              >
                {t.status === "done" ? <CheckCircle2 className="h-4 w-4 text-accent" /> : <Circle className="h-4 w-4" />}
              </button>
              <div className="min-w-0 flex-1">
                <p className={`truncate ${t.status === "done" ? "line-through" : ""}`}>{t.title}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{t.estimated_min}m</span>
                  <span>{PRIORITY_LABEL[t.priority]}</span>
                  {t.energy !== "any" && <span>{t.energy} focus</span>}
                  {t.deadline && <span>due {format(new Date(`${t.deadline}T00:00:00`), "MMM d")}</span>}
                </div>
              </div>
              <button
                onClick={() => onDelete(t.id)}
                aria-label="Delete task"
                className="text-muted-foreground/60 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewTaskForm({ onSaved }: { onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState("30");
  const [priority, setPriority] = useState("2");
  const [energy, setEnergy] = useState<"deep" | "light" | "any">("any");
  const [deadline, setDeadline] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await upsertTask({
        data: {
          title: title.trim().slice(0, 200),
          estimated_min: Math.min(480, Math.max(10, Number(minutes) || 30)),
          priority: Number(priority),
          energy,
          deadline: deadline || null,
          notes: notes.trim() ? notes.trim().slice(0, 1000) : null,
        },
      });
      setTitle(""); setNotes(""); setDeadline("");
      onSaved();
      toast.success("Task added");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save task");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-3 rounded-xl border border-border bg-card p-5">
      <div className="space-y-1.5">
        <Label htmlFor="tt">Task</Label>
        <Input id="tt" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Draft the Q3 proposal" maxLength={200} required />
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="tm">Minutes</Label>
          <Input id="tm" type="number" min={10} max={480} step={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Priority</Label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">High</SelectItem>
              <SelectItem value="2">Normal</SelectItem>
              <SelectItem value="3">Low</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Energy</Label>
          <Select value={energy} onValueChange={(v) => setEnergy(v as typeof energy)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any</SelectItem>
              <SelectItem value="deep">Deep</SelectItem>
              <SelectItem value="light">Light</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="td">Deadline</Label>
          <Input id="td" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tn">Notes</Label>
        <Textarea id="tn" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} className="resize-none" placeholder="Optional" />
      </div>
      <Button type="submit" disabled={saving || !title.trim()} className="bg-foreground text-background hover:bg-foreground/90">
        <Plus className="h-4 w-4 mr-1.5" /> {saving ? "Adding…" : "Add task"}
      </Button>
    </form>
  );
}
