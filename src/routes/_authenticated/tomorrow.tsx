import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useEffect } from "react";
import { format, addDays, isSameDay } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { listTasks, autoScheduleTasks, dailyBriefing, type AutoScheduleResult, type Briefing } from "@/lib/tasks.functions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { ArrowLeft, Clock, Moon, Sparkles, Wand2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/tomorrow")({
  component: TomorrowPage,
  head: () => ({
    meta: [
      { title: "Plan tomorrow · Chronos-V" },
      {
        name: "description",
        content: "Wrap up the day: review tomorrow's commitments and place any unscheduled tasks into the gaps.",
      },
      { property: "og:title", content: "Plan tomorrow · Chronos-V" },
      { property: "og:description", content: "Review tomorrow and place remaining tasks into free time." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Appointment = { id: string; title: string; starts_at: string; ends_at: string | null };

function TomorrowPage() {
  const qc = useQueryClient();
  const tomorrow = addDays(new Date(), 1);
  const dateStr = format(tomorrow, "yyyy-MM-dd");

  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<AutoScheduleResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [brief, setBrief] = useState<Briefing | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);

  const { data: appts } = useQuery({
    queryKey: ["appointments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("appointments").select("*").order("starts_at");
      if (error) throw error;
      return (data ?? []) as Appointment[];
    },
  });

  const { data: tasks } = useQuery({ queryKey: ["tasks"], queryFn: () => listTasks() });

  const dayAppts = useMemo(
    () => (appts ?? []).filter((a) => isSameDay(new Date(a.starts_at), tomorrow)),
    [appts, tomorrow],
  );
  const openTasks = useMemo(() => (tasks ?? []).filter((t) => t.status === "open"), [tasks]);

  // Preselect everything unscheduled the first time the backlog loads.
  useEffect(() => {
    if (openTasks.length > 0 && selected.length === 0) setSelected(openTasks.map((t) => t.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTasks.length]);

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function runPreview() {
    if (selected.length === 0) return;
    setBusy(true);
    setPreview(null);
    try {
      const res = await autoScheduleTasks({ data: { date: dateStr, dryRun: true, taskIds: selected } });
      setPreview(res);
      if (res.placements.length === 0) toast.message("No room in tomorrow's working hours for those tasks.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't build tomorrow's plan");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    try {
      const res = await autoScheduleTasks({ data: { date: dateStr, dryRun: false, taskIds: selected } });
      setPreview(null);
      setSelected([]);
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["appointments"] });
      toast.success(`Placed ${res.placements.length} task${res.placements.length === 1 ? "" : "s"} into tomorrow`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't apply the plan");
    } finally {
      setBusy(false);
    }
  }

  async function runBrief() {
    setBriefBusy(true);
    try {
      setBrief(await dailyBriefing({ data: { date: dateStr } }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't write the review");
    } finally {
      setBriefBusy(false);
    }
  }

  return (
    <div className="relative min-h-screen bg-background">
      <div className="absolute inset-0 paper-grain opacity-30 pointer-events-none" />
      <div className="relative mx-auto max-w-2xl px-5 py-8 md:py-12">
        <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
          <Link to="/today"><ArrowLeft className="h-4 w-4 mr-1" /> Today</Link>
        </Button>

        <h1 className="mt-6 flex items-center gap-2 font-serif text-4xl text-foreground">
          <Moon className="h-6 w-6 text-accent" /> Close out the day
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Here's {format(tomorrow, "EEEE, MMMM d")}. Review what's fixed, then drop the rest of your tasks into the gaps.
        </p>

        <section className="mt-8 rounded-xl border border-border bg-card p-5">
          <h2 className="font-serif text-xl">Tomorrow's commitments · {dayAppts.length}</h2>
          {dayAppts.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Nothing scheduled yet — the day is wide open.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {dayAppts.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{a.title}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {format(new Date(a.starts_at), "h:mm a")}
                    {a.ends_at ? ` – ${format(new Date(a.ends_at), "h:mm a")}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4">
            <Button variant="outline" size="sm" onClick={runBrief} disabled={briefBusy}>
              <Sparkles className="h-3.5 w-3.5 mr-1.5" /> {briefBusy ? "Thinking…" : "AI read on tomorrow"}
            </Button>
            {brief && (
              <div className="mt-3 rounded-lg bg-secondary/60 p-4">
                <p className="font-serif text-base">{brief.headline}</p>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {brief.bullets.map((b, i) => (
                    <li key={i}>· {b}</li>
                  ))}
                </ul>
                {brief.focus && <p className="mt-2 text-sm text-accent">Protect time for: {brief.focus}</p>}
              </div>
            )}
          </div>
        </section>

        <section className="mt-6 rounded-xl border border-border bg-card p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-serif text-xl">Unscheduled tasks · {openTasks.length}</h2>
            {openTasks.length > 0 && (
              <button
                className="text-xs text-muted-foreground underline"
                onClick={() => setSelected(selected.length === openTasks.length ? [] : openTasks.map((t) => t.id))}
              >
                {selected.length === openTasks.length ? "Clear all" : "Select all"}
              </button>
            )}
          </div>

          {openTasks.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Backlog is clear. <Link to="/tasks" className="underline">Add a task</Link>
            </p>
          ) : (
            <>
              <ul className="mt-3 space-y-2">
                {openTasks.map((t) => (
                  <li key={t.id} className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5">
                    <Checkbox
                      id={`t-${t.id}`}
                      checked={selected.includes(t.id)}
                      onCheckedChange={() => toggle(t.id)}
                      className="mt-0.5"
                    />
                    <label htmlFor={`t-${t.id}`} className="min-w-0 flex-1 cursor-pointer">
                      <span className="block truncate text-sm">{t.title}</span>
                      <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{t.estimated_min}m</span>
                        {t.deadline && <span>due {format(new Date(`${t.deadline}T00:00:00`), "MMM d")}</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>

              <Button
                onClick={runPreview}
                disabled={busy || selected.length === 0}
                className="mt-4 bg-accent text-accent-foreground hover:bg-accent/90"
              >
                <Wand2 className="h-4 w-4 mr-1.5" />
                {busy ? "Working…" : `Propose times for ${selected.length} task${selected.length === 1 ? "" : "s"}`}
              </Button>
            </>
          )}

          {preview && (
            <div className="mt-5 space-y-3 border-t border-border pt-4">
              <p className="text-xs text-muted-foreground">Profile: {preview.profile}</p>
              {preview.placements.map((p) => (
                <div key={p.task_id} className="flex items-center justify-between text-sm">
                  <span className="min-w-0 truncate">{p.title}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {format(new Date(p.starts_at), "h:mm a")} – {format(new Date(p.ends_at), "h:mm a")}
                  </span>
                </div>
              ))}
              {preview.unplaced.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  No room for: {preview.unplaced.map((u) => u.title).join(", ")}
                </p>
              )}
              {preview.placements.length > 0 && (
                <div className="flex gap-2 pt-1">
                  <Button onClick={apply} disabled={busy} className="bg-foreground text-background hover:bg-foreground/90">
                    Add to tomorrow
                  </Button>
                  <Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
