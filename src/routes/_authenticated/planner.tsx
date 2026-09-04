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
import {
  Sparkles,
  Wand2,
  CalendarRange,
  ListChecks,
  SlidersHorizontal,
  AlertTriangle,
  Check,
  MoveRight,
  X,
} from "lucide-react";
import {
  optimizeDay,
  planTask,
  planWeek,
  applyDayPlan,
  previewDayPlan,
  applyWeekPlan,
  listPlannerProfiles,
  getPrefsForDate,
  type DailyPlanItem,
  type PlannerProfile,
  type WeekProposalItem,
} from "@/lib/planner.functions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";

export const Route = createFileRoute("/_authenticated/planner")({
  component: PlannerPage,
});

type Resolution = "shift" | "skip" | "force";

function fmtTime(iso: string) {
  return format(new Date(iso), "HH:mm");
}
function fmtDateTime(iso: string) {
  return format(new Date(iso), "EEE MMM d · HH:mm");
}

function PlannerPage() {
  return (
    <div className="verolane-wash relative min-h-screen bg-background">
      <div className="absolute inset-0 paper-grain opacity-30 pointer-events-none" />
      <div className="relative mx-auto max-w-[1180px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <WorkspaceHeader
          eyebrow="AI daily planner"
          title={
            <>
              Let AI <span className="text-accent italic">shape</span> your time.
            </>
          }
          description="Optimize a day, capture a quick task, or break goals into a week of focused blocks. You review every proposal before it changes your schedule."
          action={
            <Button asChild variant="outline" className="bg-card/80">
              <Link to="/planner/preferences">
                <SlidersHorizontal className="mr-1.5 h-4 w-4" /> Preferences
              </Link>
            </Button>
          }
        />

        <Tabs defaultValue="day" className="mt-8">
          <TabsList className="grid h-auto w-full max-w-lg grid-cols-3 rounded-xl bg-secondary/80 p-1">
            <TabsTrigger value="day">
              <Wand2 className="h-3.5 w-3.5 mr-1.5" /> Day
            </TabsTrigger>
            <TabsTrigger value="task">
              <ListChecks className="h-3.5 w-3.5 mr-1.5" /> Quick task
            </TabsTrigger>
            <TabsTrigger value="week">
              <CalendarRange className="h-3.5 w-3.5 mr-1.5" /> Week
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="day"
            className="mt-5 rounded-2xl border border-border bg-card/90 p-5 shadow-[0_18px_45px_rgba(0,46,40,0.04)] sm:p-6"
          >
            <DayOptimizer />
          </TabsContent>
          <TabsContent
            value="task"
            className="mt-5 rounded-2xl border border-border bg-card/90 p-5 shadow-[0_18px_45px_rgba(0,46,40,0.04)] sm:p-6"
          >
            <QuickTask />
          </TabsContent>
          <TabsContent
            value="week"
            className="mt-5 rounded-2xl border border-border bg-card/90 p-5 shadow-[0_18px_45px_rgba(0,46,40,0.04)] sm:p-6"
          >
            <WeekPlanner />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

type DayPreview = Awaited<ReturnType<typeof previewDayPlan>>;

function DayOptimizer() {
  const qc = useQueryClient();
  const { data: profiles } = useQuery({
    queryKey: ["planner-profiles"],
    queryFn: () => listPlannerProfiles(),
  });
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [profileId, setProfileId] = useState<string>("");
  const [workStart, setWorkStart] = useState("09:00");
  const [workEnd, setWorkEnd] = useState("18:00");
  const [goals, setGoals] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [plan, setPlan] = useState<{ summary: string; items: DailyPlanItem[] } | null>(null);
  const [resolution, setResolution] = useState<Resolution>("shift");
  const [preview, setPreview] = useState<DayPreview | null>(null);

  const { data: dayPrefs } = useQuery({
    queryKey: ["planner-prefs-for-date", date],
    queryFn: () => getPrefsForDate({ data: { date } }),
    enabled: !!date,
  });

  const activeProfile: PlannerProfile | undefined =
    (profileId && profiles?.find((p) => p.id === profileId)) || dayPrefs || undefined;

  useEffect(() => {
    if (activeProfile) {
      setWorkStart(activeProfile.work_start);
      setWorkEnd(activeProfile.work_end);
    }
  }, [activeProfile]);

  // Re-run preview whenever the plan or resolution changes
  useEffect(() => {
    if (!plan) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    previewDayPlan({ data: { date, items: plan.items, resolution } })
      .then((res) => {
        if (!cancelled) setPreview(res);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      })
      .finally(() => {
        if (!cancelled) setPreviewing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [plan, resolution, date]);

  async function run() {
    setBusy(true);
    setPreview(null);
    try {
      const res = await optimizeDay({
        data: {
          date,
          workStart,
          workEnd,
          goals: goals || undefined,
          profileId: profileId || undefined,
        },
      });
      setPlan(res);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't build plan");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!plan) return;
    setApplying(true);
    try {
      const res = await applyDayPlan({ data: { date, items: plan.items, resolution } });
      const parts: string[] = [];
      if (res.created > 0) parts.push(`added ${res.created}`);
      if (res.shifted.length > 0) parts.push(`shifted ${res.shifted.length}`);
      if (res.skipped.length > 0) parts.push(`skipped ${res.skipped.length}`);
      if (res.created > 0 || res.shifted.length > 0) {
        toast.success(`Schedule updated: ${parts.join(", ")}`);
        qc.invalidateQueries({ queryKey: ["appointments"] });
        setPlan(null);
        setPreview(null);
      } else if (res.skipped.length > 0) {
        toast.warning(`All ${res.skipped.length} blocks conflicted — nothing added`);
      } else {
        toast.message("Nothing new to add");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't apply plan");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-1 space-y-1.5">
          <Label htmlFor="d">Date</Label>
          <Input id="d" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ws">Work start</Label>
          <Input
            id="ws"
            type="time"
            value={workStart}
            onChange={(e) => setWorkStart(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="we">Work end</Label>
          <Input id="we" type="time" value={workEnd} onChange={(e) => setWorkEnd(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Profile</Label>
        <Select
          value={profileId || "__auto"}
          onValueChange={(v) => setProfileId(v === "__auto" ? "" : v)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__auto">
              Auto for date{dayPrefs ? ` · ${dayPrefs.name}` : ""}
            </SelectItem>
            {(profiles ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
                {p.is_default ? " (default)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="g">Priorities (optional)</Label>
        <Textarea
          id="g"
          value={goals}
          onChange={(e) => setGoals(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="e.g. Ship the planner feature, prep Friday demo, gym at 6pm"
          className="resize-none"
        />
      </div>
      <Button
        onClick={run}
        disabled={busy}
        className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
      >
        {busy ? (
          "Planning…"
        ) : (
          <>
            <Sparkles className="h-4 w-4 mr-1.5" /> Build my day
          </>
        )}
      </Button>

      {plan && (
        <div className="mt-6 rounded-xl border border-border bg-card p-5">
          <p className="font-serif text-lg text-foreground">{plan.summary}</p>

          <div className="mt-4 space-y-1.5">
            <Label className="text-xs">When a block conflicts with an existing appointment</Label>
            <Select value={resolution} onValueChange={(v) => setResolution(v as Resolution)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="shift">Shift after the conflict</SelectItem>
                <SelectItem value="skip">Skip conflicting blocks</SelectItem>
                <SelectItem value="force">Add anyway (allow overlap)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <ConfirmSummary loading={previewing} preview={preview} resolution={resolution} />

          <div className="mt-5 flex gap-2">
            <Button
              onClick={apply}
              disabled={applying || previewing || !preview || preview.accepted.length === 0}
              className="flex-1 bg-foreground text-background hover:bg-foreground/90"
            >
              {applying
                ? "Adding…"
                : preview
                  ? `Confirm & add ${preview.accepted.length} block${preview.accepted.length === 1 ? "" : "s"}`
                  : "Preparing preview…"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setPlan(null);
                setPreview(null);
              }}
              disabled={applying}
            >
              Discard
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ConfirmSummary({
  loading,
  preview,
  resolution,
}: {
  loading: boolean;
  preview: {
    accepted: { title: string; starts_at: string; ends_at: string }[];
    shifted: { title: string; from: string; to: string; conflictsWith: string }[];
    skipped: { title: string; starts_at: string; conflictsWith: string }[];
    conflicts: { title: string; starts_at: string; conflictsWith: string }[];
    existingCount?: number;
  } | null;
  resolution: Resolution;
}) {
  if (loading && !preview) {
    return <p className="mt-4 text-xs text-muted-foreground">Checking conflicts…</p>;
  }
  if (!preview) return null;

  const shiftedMap = new Map(preview.shifted.map((s) => [`${s.title}|${s.to}`, s]));
  const cleanAdds = preview.accepted.filter((a) => !shiftedMap.has(`${a.title}|${a.starts_at}`));

  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-lg border border-border bg-secondary/30 p-3">
        <p className="text-xs font-medium text-foreground">Confirm changes</p>
        <div className="mt-1.5 flex flex-wrap gap-2 text-[11px]">
          <Pill tone="ok">
            <Check className="h-3 w-3" /> {cleanAdds.length} adding cleanly
          </Pill>
          {preview.shifted.length > 0 && (
            <Pill tone="warn">
              <MoveRight className="h-3 w-3" /> {preview.shifted.length} shifted
            </Pill>
          )}
          {preview.skipped.length > 0 && (
            <Pill tone="muted">
              <X className="h-3 w-3" /> {preview.skipped.length} skipped
            </Pill>
          )}
          {preview.conflicts.length === 0 && <Pill tone="muted">No conflicts</Pill>}
        </div>
      </div>

      {cleanAdds.length > 0 && (
        <Section title={`Will be added (${cleanAdds.length})`}>
          {cleanAdds.map((a, i) => (
            <Row
              key={`a${i}`}
              time={`${fmtTime(a.starts_at)}–${fmtTime(a.ends_at)}`}
              title={a.title}
              tone="ok"
            />
          ))}
        </Section>
      )}

      {preview.shifted.length > 0 && (
        <Section title={`Shifted to avoid conflicts (${preview.shifted.length})`}>
          {preview.shifted.map((s, i) => (
            <Row
              key={`s${i}`}
              time={`${fmtTime(s.from)} → ${fmtTime(s.to)}`}
              title={s.title}
              hint={`overlapped "${s.conflictsWith}"`}
              tone="warn"
            />
          ))}
        </Section>
      )}

      {preview.skipped.length > 0 && (
        <Section title={`Will be skipped (${preview.skipped.length})`}>
          {preview.skipped.map((s, i) => (
            <Row
              key={`k${i}`}
              time={fmtTime(s.starts_at)}
              title={s.title}
              hint={`conflicts with "${s.conflictsWith}"${resolution === "shift" ? " — couldn't find a slot" : ""}`}
              tone="muted"
            />
          ))}
        </Section>
      )}

      {resolution === "force" && preview.conflicts.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 inline-flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            <b>{preview.conflicts.length}</b> block{preview.conflicts.length === 1 ? "" : "s"} will
            overlap existing appointments.
          </span>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60">
      <div className="px-3 py-2 border-b border-border/60 text-[11px] uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <ul className="divide-y divide-border/40">{children}</ul>
    </div>
  );
}

function Row({
  time,
  title,
  hint,
  tone,
}: {
  time: string;
  title: string;
  hint?: string;
  tone: "ok" | "warn" | "muted";
}) {
  const dot =
    tone === "ok" ? "bg-emerald-500" : tone === "warn" ? "bg-amber-500" : "bg-muted-foreground/40";
  return (
    <li className="flex items-start gap-3 px-3 py-2">
      <span className={`mt-1.5 h-1.5 w-1.5 rounded-full ${dot} shrink-0`} />
      <span className="font-mono text-[11px] text-muted-foreground w-28 shrink-0 pt-0.5">
        {time}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">{title}</p>
        {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
      </div>
    </li>
  );
}

function Pill({ tone, children }: { tone: "ok" | "warn" | "muted"; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "bg-emerald-500/10 text-emerald-700"
      : tone === "warn"
        ? "bg-amber-500/10 text-amber-700"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${cls}`}>
      {children}
    </span>
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
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Label htmlFor="qt">Describe a task</Label>
      <Textarea
        id="qt"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        maxLength={1000}
        placeholder='e.g. "30 min workout tomorrow morning" or "Call mom Sunday evening"'
        className="resize-none"
      />
      <Button
        onClick={run}
        disabled={busy || !text.trim()}
        className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
      >
        {busy ? (
          "Scheduling…"
        ) : (
          <>
            <Sparkles className="h-4 w-4 mr-1.5" /> Schedule it
          </>
        )}
      </Button>
    </div>
  );
}

type WeekDraft = {
  summary: string;
  proposals: WeekProposalItem[];
  preview: {
    accepted: { title: string; starts_at: string; ends_at: string }[];
    skipped: { title: string; starts_at: string; conflictsWith: string }[];
    shifted: { title: string; from: string; to: string; conflictsWith: string }[];
    conflicts: { title: string; starts_at: string; conflictsWith: string }[];
  };
  startDate: string;
  days: number;
  profileId: string;
};

function WeekPlanner() {
  const qc = useQueryClient();
  const { data: profiles } = useQuery({
    queryKey: ["planner-profiles"],
    queryFn: () => listPlannerProfiles(),
  });
  const [goals, setGoals] = useState("");
  const [startDate, setStartDate] = useState(format(addDays(new Date(), 1), "yyyy-MM-dd"));
  const [days, setDays] = useState(7);
  const [profileId, setProfileId] = useState<string>("");
  const [resolution, setResolution] = useState<Resolution>("shift");
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [draft, setDraft] = useState<WeekDraft | null>(null);

  async function preview() {
    if (!goals.trim()) return;
    setBusy(true);
    try {
      const res = await planWeek({
        data: {
          goals,
          startDate,
          days,
          profileId: profileId || undefined,
          resolution,
          dryRun: true,
        },
      });
      if (!res.dryRun) return;
      setDraft({
        summary: res.summary,
        proposals: res.proposals,
        preview: res.preview,
        startDate,
        days,
        profileId,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't plan");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!draft) return;
    setApplying(true);
    try {
      const res = await applyWeekPlan({
        data: {
          startDate: draft.startDate,
          days: draft.days,
          items: draft.proposals,
          resolution,
          profileId: draft.profileId || undefined,
        },
      });
      const bits: string[] = [];
      if (res.created > 0) bits.push(`${res.created} added`);
      if (res.shifted?.length) bits.push(`${res.shifted.length} shifted`);
      if (res.skipped?.length) bits.push(`${res.skipped.length} skipped`);
      toast.success(bits.join(" · ") || "Plan applied");
      qc.invalidateQueries({ queryKey: ["appointments"] });
      setDraft(null);
      setGoals("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't apply");
    } finally {
      setApplying(false);
    }
  }

  // Re-resolve preview locally when resolution changes? Cheaper: re-call planWeek dry would re-pay AI.
  // Instead we re-run a server resolution via applyWeekPlan dry — not available. So we re-call with same
  // proposals via a tiny helper would require another endpoint. Keep it simple: warn that changing
  // resolution requires "Rebuild" preview.

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="wg">Goals for this stretch</Label>
        <Textarea
          id="wg"
          value={goals}
          onChange={(e) => setGoals(e.target.value)}
          rows={5}
          maxLength={2000}
          placeholder="e.g. Finish Q3 report draft, run 3x, prep onboarding doc for new hire, read 2 chapters of Designing Data-Intensive Apps"
          className="resize-none"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="sd">Start</Label>
          <Input
            id="sd"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dn">Days</Label>
          <Input
            id="dn"
            type="number"
            min={1}
            max={14}
            value={days}
            onChange={(e) => setDays(Number(e.target.value) || 7)}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Profile</Label>
        <Select
          value={profileId || "__auto"}
          onValueChange={(v) => setProfileId(v === "__auto" ? "" : v)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__auto">Auto (use assigned/default for start date)</SelectItem>
            {(profiles ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
                {p.is_default ? " (default)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>On conflict with existing appointments</Label>
        <Select value={resolution} onValueChange={(v) => setResolution(v as Resolution)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="shift">Shift block after the conflict</SelectItem>
            <SelectItem value="skip">Skip conflicting blocks</SelectItem>
            <SelectItem value="force">Add anyway (allow overlap)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button
        onClick={preview}
        disabled={busy || !goals.trim()}
        className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
      >
        {busy ? (
          "Planning week…"
        ) : (
          <>
            <Sparkles className="h-4 w-4 mr-1.5" /> Preview my week
          </>
        )}
      </Button>

      {draft && (
        <div className="mt-6 rounded-xl border border-border bg-card p-5 space-y-4">
          <p className="font-serif text-lg text-foreground">{draft.summary}</p>

          <WeekConfirm draft={draft} resolution={resolution} />

          {draft.preview.skipped.length + draft.preview.shifted.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Preview reflects "<b>{resolutionLabel(resolution)}</b>". Change the strategy above and
              click <i>Preview my week</i> again to re-resolve.
            </p>
          )}

          <div className="flex gap-2">
            <Button
              onClick={apply}
              disabled={applying || draft.preview.accepted.length === 0}
              className="flex-1 bg-foreground text-background hover:bg-foreground/90"
            >
              {applying
                ? "Adding…"
                : `Confirm & add ${draft.preview.accepted.length} block${draft.preview.accepted.length === 1 ? "" : "s"}`}
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)} disabled={applying}>
              Discard
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function resolutionLabel(r: Resolution) {
  return r === "shift"
    ? "Shift after the conflict"
    : r === "skip"
      ? "Skip conflicts"
      : "Add anyway";
}

function WeekConfirm({ draft, resolution }: { draft: WeekDraft; resolution: Resolution }) {
  const p = draft.preview;
  const shiftedMap = new Map(p.shifted.map((s) => [`${s.title}|${s.to}`, s]));
  const cleanAdds = p.accepted.filter((a) => !shiftedMap.has(`${a.title}|${a.starts_at}`));

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-secondary/30 p-3">
        <p className="text-xs font-medium text-foreground">
          Confirm changes across {draft.days} day{draft.days === 1 ? "" : "s"}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-2 text-[11px]">
          <Pill tone="ok">
            <Check className="h-3 w-3" /> {cleanAdds.length} adding cleanly
          </Pill>
          {p.shifted.length > 0 && (
            <Pill tone="warn">
              <MoveRight className="h-3 w-3" /> {p.shifted.length} shifted
            </Pill>
          )}
          {p.skipped.length > 0 && (
            <Pill tone="muted">
              <X className="h-3 w-3" /> {p.skipped.length} skipped
            </Pill>
          )}
          {p.conflicts.length === 0 && <Pill tone="muted">No conflicts</Pill>}
        </div>
      </div>

      {cleanAdds.length > 0 && (
        <Section title={`Will be added (${cleanAdds.length})`}>
          {cleanAdds.map((a, i) => (
            <Row key={`a${i}`} time={fmtDateTime(a.starts_at)} title={a.title} tone="ok" />
          ))}
        </Section>
      )}
      {p.shifted.length > 0 && (
        <Section title={`Shifted to avoid conflicts (${p.shifted.length})`}>
          {p.shifted.map((s, i) => (
            <Row
              key={`s${i}`}
              time={`${fmtDateTime(s.from)} → ${fmtTime(s.to)}`}
              title={s.title}
              hint={`overlapped "${s.conflictsWith}"`}
              tone="warn"
            />
          ))}
        </Section>
      )}
      {p.skipped.length > 0 && (
        <Section title={`Will be skipped (${p.skipped.length})`}>
          {p.skipped.map((s, i) => (
            <Row
              key={`k${i}`}
              time={fmtDateTime(s.starts_at)}
              title={s.title}
              hint={`conflicts with "${s.conflictsWith}"${resolution === "shift" ? " — couldn't find a slot" : ""}`}
              tone="muted"
            />
          ))}
        </Section>
      )}
      {resolution === "force" && p.conflicts.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 inline-flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            <b>{p.conflicts.length}</b> block{p.conflicts.length === 1 ? "" : "s"} will overlap
            existing appointments.
          </span>
        </div>
      )}
    </div>
  );
}
