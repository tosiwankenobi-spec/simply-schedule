import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { format, isSameDay, differenceInMinutes } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { listTasks, upsertTask, setTaskStatus } from "@/lib/tasks.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SyncAlert } from "@/components/SyncAlert";
import { NotificationBell } from "@/components/NotificationBell";
import { TaskNudge } from "@/components/TaskNudge";
import { toast } from "sonner";
import {
  CalendarDays,
  CheckCircle2,
  Circle,
  Clock,
  ListTodo,
  MapPin,
  Moon,
  Plus,
  Sparkles,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/today")({
  component: TodayPage,
  head: () => ({
    meta: [
      { title: "Today · Chronos-V" },
      {
        name: "description",
        content: "Your next appointment, overdue tasks and one-tap capture for anything new.",
      },
      { property: "og:title", content: "Today · Chronos-V" },
      { property: "og:description", content: "Your next appointment, overdue tasks and quick capture." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Appointment = {
  id: string;
  title: string;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
};

function TodayPage() {
  const now = new Date();

  const { data: appts } = useQuery({
    queryKey: ["appointments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select("*")
        .order("starts_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Appointment[];
    },
  });

  const { data: tasks } = useQuery({ queryKey: ["tasks"], queryFn: () => listTasks() });

  const { next, todayList, overdue } = useMemo(() => {
    const list = appts ?? [];
    const upcoming = list.filter((a) => new Date(a.ends_at ?? a.starts_at) >= now);
    const todayList = list.filter((a) => isSameDay(new Date(a.starts_at), now));
    const today = format(now, "yyyy-MM-dd");
    const overdue = (tasks ?? []).filter(
      (t) => t.status !== "done" && t.deadline && t.deadline < today,
    );
    return { next: upcoming[0] ?? null, todayList, overdue };
  }, [appts, tasks, now]);

  return (
    <div className="relative min-h-screen bg-background pb-28">
      <div className="absolute inset-0 paper-grain opacity-30 pointer-events-none" />
      <div className="relative mx-auto max-w-lg px-4 py-6">
        <div className="flex items-baseline justify-between">
          <div>
            <h1 className="font-serif text-3xl text-foreground">Today</h1>
            <p className="text-sm text-muted-foreground">{format(now, "EEEE, MMMM d")}</p>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <Link to="/app">
                <CalendarDays className="h-4 w-4 mr-1" /> Full schedule
              </Link>
            </Button>
          </div>
        </div>

        <SyncAlert />

        <div className="mt-4"><TaskNudge /></div>

        <section className="mt-6">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Up next</h2>
          {next ? (
            <div className="rounded-2xl border border-accent/40 bg-card px-5 py-5">
              <p className="font-serif text-xl text-foreground">{next.title}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  {format(new Date(next.starts_at), "h:mm a")}
                  {next.ends_at ? ` – ${format(new Date(next.ends_at), "h:mm a")}` : ""}
                </span>
                {next.location && (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" /> {next.location}
                  </span>
                )}
              </div>
              <p className="mt-3 text-xs text-accent">{relativeLabel(now, new Date(next.starts_at))}</p>
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
              Nothing left on the calendar.
            </p>
          )}
        </section>

        <section className="mt-8">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Rest of today · {todayList.length}
          </h2>
          {todayList.length === 0 ? (
            <p className="text-sm text-muted-foreground">No appointments today.</p>
          ) : (
            <ul className="space-y-2">
              {todayList.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
                >
                  <span className="min-w-0 truncate text-sm text-foreground">{a.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {format(new Date(a.starts_at), "h:mm a")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <OverdueSection items={overdue} />

        <div className="mt-8 grid grid-cols-2 gap-2">
          <Button asChild variant="outline">
            <Link to="/tasks">
              <ListTodo className="h-4 w-4 mr-1.5" /> Backlog
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/tomorrow">
              <Moon className="h-4 w-4 mr-1.5" /> Plan tomorrow
            </Link>
          </Button>
        </div>
      </div>

      <QuickAddBar />
    </div>
  );
}

function relativeLabel(now: Date, start: Date) {
  const mins = differenceInMinutes(start, now);
  if (mins < 0) return "Happening now";
  if (mins < 60) return `In ${mins} minute${mins === 1 ? "" : "s"}`;
  const hrs = Math.round(mins / 60);
  if (isSameDay(now, start)) return `In about ${hrs} hour${hrs === 1 ? "" : "s"}`;
  return format(start, "EEE, MMM d");
}

function OverdueSection({ items }: { items: Awaited<ReturnType<typeof listTasks>> }) {
  const qc = useQueryClient();
  if (items.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-destructive">
        Overdue · {items.length}
      </h2>
      <ul className="space-y-2">
        {items.map((t) => (
          <li
            key={t.id}
            className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3"
          >
            <button
              aria-label="Mark done"
              className="mt-0.5 text-muted-foreground hover:text-accent"
              onClick={async () => {
                await setTaskStatus({ data: { id: t.id, status: "done" } });
                qc.invalidateQueries({ queryKey: ["tasks"] });
              }}
            >
              <Circle className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-foreground">{t.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Due {t.deadline ? format(new Date(`${t.deadline}T00:00:00`), "MMM d") : "—"} · {t.estimated_min}m
              </p>
            </div>
            <CheckCircle2 className="mt-0.5 h-4 w-4 text-transparent" />
          </li>
        ))}
      </ul>
    </section>
  );
}

function QuickAddBar() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-lg gap-2">
        <QuickTaskSheet />
        <QuickApptSheet />
      </div>
    </div>
  );
}

function QuickTaskSheet() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState("30");
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
          priority: 2,
          energy: "any",
        },
      });
      setTitle("");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Task added");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save task");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" className="flex-1">
          <ListTodo className="h-4 w-4 mr-1.5" /> Quick task
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader>
          <SheetTitle className="font-serif">New task</SheetTitle>
        </SheetHeader>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="qt">Task</Label>
            <Input id="qt" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Call the supplier" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qtm">Minutes</Label>
            <Input id="qtm" type="number" min={10} max={480} step={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </div>
          <Button type="submit" disabled={saving || !title.trim()} className="w-full bg-foreground text-background hover:bg-foreground/90">
            <Plus className="h-4 w-4 mr-1.5" /> {saving ? "Adding…" : "Add task"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function QuickApptSheet() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [time, setTime] = useState("09:00");
  const [minutes, setMinutes] = useState("30");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const starts = new Date(`${date}T${time}:00`);
      const ends = new Date(starts.getTime() + (Number(minutes) || 30) * 60000);
      const { error } = await supabase.from("appointments").insert({
        title: title.trim().slice(0, 200),
        starts_at: starts.toISOString(),
        ends_at: ends.toISOString(),
        source: "manual",
      } as never);
      if (error) throw error;
      setTitle("");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["appointments"] });
      toast.success("Appointment added");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save appointment");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90">
          <Plus className="h-4 w-4 mr-1.5" /> Quick add
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader>
          <SheetTitle className="font-serif">New appointment</SheetTitle>
        </SheetHeader>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="qa">Title</Label>
            <Input id="qa" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Coffee with Sam" autoFocus />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="qad">Date</Label>
              <Input id="qad" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qat">Time</Label>
              <Input id="qat" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qam">Mins</Label>
              <Input id="qam" type="number" min={5} max={480} step={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </div>
          </div>
          <Button type="submit" disabled={saving || !title.trim()} className="w-full bg-foreground text-background hover:bg-foreground/90">
            <Sparkles className="h-4 w-4 mr-1.5" /> {saving ? "Saving…" : "Add appointment"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
