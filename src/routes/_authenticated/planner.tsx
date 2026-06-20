import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { format, addDays } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Sparkles, ArrowLeft, Wand2, CalendarRange, ListChecks, SlidersHorizontal } from "lucide-react";
import { optimizeDay, planTask, planWeek, applyDayPlan, getPlannerPrefs, type DailyPlanItem } from "@/lib/planner.functions";

export const Route = createFileRoute("/_authenticated/planner")({
  component: PlannerPage,
});

function PlannerPage() {
  return (
    <div className="relative min-h-screen bg-background">
      <div className="absolute inset-0 paper-grain opacity-30 pointer-events-none" />
      <div className="relative mx-auto max-w-2xl px-5 py-8 md:py-12">
        <div className="flex items-center justify-between">
          <Link to="/app" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to schedule
          </Link>
          <Link to="/planner/preferences" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
            <SlidersHorizontal className="h-3.5 w-3.5 mr-1" /> Preferences
          </Link>
        </div>

        <div className="mt-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1 text-xs text-accent">
            <Sparkles className="h-3 w-3" /> AI planner
          </div>
          <h1 className="mt-3 font-serif text-4xl md:text-5xl text-foreground leading-tight">
            Let AI <span className="text-accent italic">shape</span> your time.
          </h1>
          <p className="mt-2 text-muted-foreground text-sm">
            Optimize a day, capture a quick task, or break goals into a week of focused blocks. Tune defaults in <Link to="/planner/preferences" className="underline">preferences</Link>.
          </p>
        </div>

        <Tabs defaultValue="day" className="mt-10">
          <TabsList className="bg-secondary">
            <TabsTrigger value="day"><Wand2 className="h-3.5 w-3.5 mr-1.5" /> Day</TabsTrigger>
            <TabsTrigger value="task"><ListChecks className="h-3.5 w-3.5 mr-1.5" /> Quick task</TabsTrigger>
            <TabsTrigger value="week"><CalendarRange className="h-3.5 w-3.5 mr-1.5" /> Week</TabsTrigger>
          </TabsList>

          <TabsContent value="day" className="mt-6"><DayOptimizer /></TabsContent>
          <TabsContent value="task" className="mt-6"><QuickTask /></TabsContent>
          <TabsContent value="week" className="mt-6"><WeekPlanner /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function DayOptimizer() {
  const qc = useQueryClient();
  const { data: prefs } = useQuery({ queryKey: ["planner-prefs"], queryFn: () => getPlannerPrefs() });
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [workStart, setWorkStart] = useState("09:00");
  const [workEnd, setWorkEnd] = useState("18:00");
  const [goals, setGoals] = useState("");
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [plan, setPlan] = useState<{ summary: string; items: DailyPlanItem[] } | null>(null);

  useEffect(() => {
    if (prefs) { setWorkStart(prefs.work_start); setWorkEnd(prefs.work_end); }
  }, [prefs]);

  async function run() {
    setBusy(true);
    try {
      const res = await optimizeDay({ data: { date, workStart, workEnd, goals: goals || undefined } });
      setPlan(res);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't build plan");
    } finally { setBusy(false); }
  }

  async function apply() {
    if (!plan) return;
    setApplying(true);
    try {
      const res = await applyDayPlan({ data: { date, items: plan.items } });
      if (res.created > 0) {
        toast.success(`Added ${res.created} block${res.created === 1 ? "" : "s"} to your schedule`);
        qc.invalidateQueries({ queryKey: ["appointments"] });
        setPlan(null);
      } else {
        toast.message("Nothing new to add", { description: "The plan only referenced existing appointments." });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't apply plan");
    } finally { setApplying(false); }
  }

  const newItemCount = plan?.items.filter((it) => it.kind !== "appointment").length ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-1 space-y-1.5">
          <Label htmlFor="d">Date</Label>
          <Input id="d" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ws">Work start</Label>
          <Input id="ws" type="time" value={workStart} onChange={(e) => setWorkStart(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="we">Work end</Label>
          <Input id="we" type="time" value={workEnd} onChange={(e) => setWorkEnd(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="g">Priorities (optional)</Label>
        <Textarea id="g" value={goals} onChange={(e) => setGoals(e.target.value)} rows={3} maxLength={500}
          placeholder="e.g. Ship the planner feature, prep Friday demo, gym at 6pm" className="resize-none" />
      </div>
      <Button onClick={run} disabled={busy} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
        {busy ? "Planning…" : (<><Sparkles className="h-4 w-4 mr-1.5" /> Build my day</>)}
      </Button>

      {plan && (
        <div className="mt-6 rounded-xl border border-border bg-card p-5">
          <p className="font-serif text-lg text-foreground">{plan.summary}</p>
          <ul className="mt-4 space-y-2">
            {plan.items.map((it, i) => (
              <li key={i} className="flex items-start gap-3 border-b border-border/60 pb-2 last:border-0">
                <span className="font-mono text-xs text-muted-foreground w-14 pt-0.5">{it.time}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-foreground">{it.title}</span>
                    <span className={`text-[10px] uppercase tracking-wide rounded-full px-1.5 py-0.5 ${
                      it.kind === "appointment" ? "bg-accent/10 text-accent" :
                      it.kind === "break" ? "bg-muted text-muted-foreground" : "bg-secondary text-foreground/70"
                    }`}>{it.kind}</span>
                  </div>
                  {it.rationale && <p className="text-xs text-muted-foreground mt-0.5">{it.rationale}</p>}
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex gap-2">
            <Button
              onClick={apply}
              disabled={applying || newItemCount === 0}
              className="flex-1 bg-foreground text-background hover:bg-foreground/90"
            >
              {applying ? "Adding…" : `Add ${newItemCount} block${newItemCount === 1 ? "" : "s"} to schedule`}
            </Button>
            <Button variant="ghost" onClick={() => setPlan(null)} disabled={applying}>Discard</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function QuickTask() {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const res = await planTask({ data: { text, now: new Date().toISOString() } });
      toast.success(`Scheduled: ${res?.title ?? "appointment"}`);
      qc.invalidateQueries({ queryKey: ["appointments"] });
      setText("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't schedule");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <Label htmlFor="qt">Describe a task</Label>
      <Textarea id="qt" value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={1000}
        placeholder='e.g. "30 min workout tomorrow morning" or "Call mom Sunday evening"'
        className="resize-none" />
      <Button onClick={run} disabled={busy || !text.trim()} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
        {busy ? "Scheduling…" : (<><Sparkles className="h-4 w-4 mr-1.5" /> Schedule it</>)}
      </Button>
    </div>
  );
}

function WeekPlanner() {
  const qc = useQueryClient();
  const [goals, setGoals] = useState("");
  const [startDate, setStartDate] = useState(format(addDays(new Date(), 1), "yyyy-MM-dd"));
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!goals.trim()) return;
    setBusy(true);
    try {
      const res = await planWeek({ data: { goals, startDate, days, workStart: "09:00", workEnd: "18:00" } });
      toast.success(`Created ${res.created} block${res.created === 1 ? "" : "s"}`, { description: res.summary });
      qc.invalidateQueries({ queryKey: ["appointments"] });
      setGoals("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't plan");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="wg">Goals for this stretch</Label>
        <Textarea id="wg" value={goals} onChange={(e) => setGoals(e.target.value)} rows={5} maxLength={2000}
          placeholder="e.g. Finish Q3 report draft, run 3x, prep onboarding doc for new hire, read 2 chapters of Designing Data-Intensive Apps"
          className="resize-none" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="sd">Start</Label>
          <Input id="sd" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dn">Days</Label>
          <Input id="dn" type="number" min={1} max={14} value={days} onChange={(e) => setDays(Number(e.target.value) || 7)} />
        </div>
      </div>
      <Button onClick={run} disabled={busy || !goals.trim()} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
        {busy ? "Planning week…" : (<><Sparkles className="h-4 w-4 mr-1.5" /> Plan my week</>)}
      </Button>
    </div>
  );
}
