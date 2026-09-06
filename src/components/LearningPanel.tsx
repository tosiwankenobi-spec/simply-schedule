import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Brain, Check, Info, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  acceptLearnedStrategy,
  clearLearnedStrategy,
  getLearningOverview,
  resetLearningData,
  setLearningEnabled,
} from "@/lib/learning.functions";
import { MIN_STRATEGY_EVENTS, type ConflictStrategy } from "@/lib/learning";

export const LEARNING_QUERY_KEY = ["learning-overview"] as const;

export function strategyLabel(strategy: ConflictStrategy): string {
  if (strategy === "shift") return "Shift the block after the clash";
  if (strategy === "skip") return "Skip blocks that clash";
  return "Add anyway, even if it overlaps";
}

/** Learning section for Planner preferences (full) and Privacy (compact). */
export function LearningPanel({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: LEARNING_QUERY_KEY,
    queryFn: () => getLearningOverview(),
  });

  async function invalidate() {
    await qc.invalidateQueries({ queryKey: LEARNING_QUERY_KEY });
  }

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => setLearningEnabled({ data: { enabled } }),
    onSuccess: async (res) => {
      toast.success(res.enabled ? "Learning is on" : "Learning is off");
      await invalidate();
    },
    onError: () => toast.error("That setting could not be saved."),
  });

  const accept = useMutation({
    mutationFn: (strategy: ConflictStrategy) => acceptLearnedStrategy({ data: { strategy } }),
    onSuccess: async () => {
      toast.success("Saved as your default");
      await invalidate();
    },
    onError: () => toast.error("That preference could not be saved."),
  });

  const clear = useMutation({
    mutationFn: () => clearLearnedStrategy(),
    onSuccess: async () => {
      toast.success("Default removed");
      await invalidate();
    },
    onError: () => toast.error("That preference could not be removed."),
  });

  const reset = useMutation({
    mutationFn: () => resetLearningData(),
    onSuccess: async () => {
      toast.success("Learning history cleared");
      await invalidate();
    },
    onError: () => toast.error("Your learning data could not be cleared."),
  });

  if (isLoading) {
    return (
      <SectionShell compact={compact}>
        <p className="text-sm text-muted-foreground">Loading learning settings…</p>
      </SectionShell>
    );
  }

  if (isError || !data) {
    return (
      <SectionShell compact={compact}>
        <p className="text-sm text-muted-foreground">
          Your learning settings could not be loaded.
        </p>
        <Button variant="outline" className="mt-3" onClick={() => void refetch()}>
          Try again
        </Button>
      </SectionShell>
    );
  }

  const { suggestion } = data;

  return (
    <SectionShell compact={compact}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary text-ink">
            <Brain className="h-4.5 w-4.5" />
          </span>
          <div>
            <h3 className="font-serif text-xl text-foreground">Learning from your choices</h3>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
              When this is on, Chronos-V remembers which option you pick when a suggested block
              clashes with something already in your day, so it can offer that choice by default.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={data.enabled ? "secondary" : "outline"}>
            {data.enabled ? "On" : "Off"}
          </Badge>
          <Switch
            checked={data.enabled}
            disabled={toggle.isPending}
            onCheckedChange={(next) => toggle.mutate(next)}
            aria-label="Learn from my scheduling choices"
          />
        </div>
      </div>

      <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-xl border border-border/70 bg-background/60 p-3">
          <dt className="font-medium text-foreground">What is kept</dt>
          <dd className="mt-1 text-muted-foreground">
            Only which clash option you chose, and how many blocks were offered, approved, moved or
            put back. Kept for {data.retentionDays} days, then deleted automatically.
          </dd>
        </div>
        <div className="rounded-xl border border-border/70 bg-background/60 p-3">
          <dt className="font-medium text-foreground">What is never kept</dt>
          <dd className="mt-1 text-muted-foreground">
            No titles, notes, people, places, email content, or links back to individual
            appointments, tasks or calendars.
          </dd>
        </div>
      </dl>

      {!data.enabled ? (
        <p className="mt-5 flex items-start gap-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Learning is off. Nothing is being recorded and your planner behaves exactly as before.
        </p>
      ) : (
        <div className="mt-5 space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-foreground">What we&apos;ve seen so far</h4>
            {suggestion.status === "insufficient" && (
              <p className="mt-1 text-sm text-muted-foreground">
                {suggestion.total} plan{suggestion.total === 1 ? "" : "s"} applied so far.{" "}
                {suggestion.needed} more {suggestion.needed === 1 ? "is" : "are"} needed (at least{" "}
                {MIN_STRATEGY_EVENTS}) before a suggestion appears.
              </p>
            )}
            {suggestion.status === "no-winner" && (
              <p className="mt-1 text-sm text-muted-foreground">
                Across {suggestion.total} applied plans your choices are still mixed — shift{" "}
                {suggestion.counts.shift}, skip {suggestion.counts.skip}, add anyway{" "}
                {suggestion.counts.force}. No clear preference yet.
              </p>
            )}
            {suggestion.status === "suggested" && (
              <div className="mt-2 rounded-xl border border-accent/40 bg-accent/5 p-4">
                <p className="text-sm text-foreground">
                  You chose <b>{strategyLabel(suggestion.strategy).toLowerCase()}</b> in{" "}
                  <b>
                    {suggestion.count} of {suggestion.total}
                  </b>{" "}
                  applied plans ({suggestion.percent}%).
                </p>
                {data.acceptedStrategy === suggestion.strategy ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    This is already your saved default.
                  </p>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      className="bg-accent text-accent-foreground hover:bg-accent/90"
                      disabled={accept.isPending}
                      onClick={() => accept.mutate(suggestion.strategy)}
                    >
                      <Check className="mr-1.5 h-4 w-4" /> Use this as my default
                    </Button>
                    <Button variant="ghost" onClick={() => toast.message("Suggestion dismissed")}>
                      <X className="mr-1.5 h-4 w-4" /> Not now
                    </Button>
                  </div>
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                  A default only pre-selects the option — every plan still waits for your approval,
                  and you can change the choice each time.
                </p>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border/70 bg-background/60 p-4">
            <h4 className="text-sm font-semibold text-foreground">Your saved default</h4>
            {data.acceptedStrategy ? (
              <>
                <p className="mt-1 text-sm text-muted-foreground">
                  {strategyLabel(data.acceptedStrategy)}
                  {data.acceptedAt
                    ? ` · saved ${format(new Date(data.acceptedAt), "MMM d, yyyy")}`
                    : ""}
                </p>
                {!data.acceptedSupported && (
                  <p className="mt-2 text-sm text-foreground">
                    Heads up: your recent choices point somewhere else. Nothing has been changed —
                    you can keep this default or remove it.
                  </p>
                )}
                <Button
                  variant="outline"
                  className="mt-3"
                  disabled={clear.isPending}
                  onClick={() => clear.mutate()}
                >
                  Remove default
                </Button>
              </>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                None saved. Your planner behaves exactly as it always has.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-border/70 bg-background/60 p-4">
            <h4 className="text-sm font-semibold text-foreground">Recent activity</h4>
            <p className="mt-1 text-sm text-muted-foreground">
              {data.activity.plansApplied} plan
              {data.activity.plansApplied === 1 ? "" : "s"} applied ·{" "}
              {data.activity.replansApproved} reshuffle
              {data.activity.replansApproved === 1 ? "" : "s"} approved (
              {data.activity.blocksApproved} of {data.activity.blocksOffered} blocks) ·{" "}
              {data.activity.undos} undo
              {data.activity.undos === 1 ? "" : "s"} ({data.activity.blocksRestored} put back,{" "}
              {data.activity.blocksLeftAlone} left alone)
            </p>
          </div>
        </div>
      )}

      <div className="mt-5 border-t border-border/70 pt-4">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" className="text-destructive hover:text-destructive">
              <Trash2 className="mr-1.5 h-4 w-4" /> Reset learning data
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete your learning history?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes what Chronos-V has learned from your choices and removes
                your saved default. Your appointments, tasks, planner profiles, plan history and
                connected accounts are not affected. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction
                disabled={reset.isPending}
                onClick={() => reset.mutate()}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete learning data
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </SectionShell>
  );
}

function SectionShell({ compact, children }: { compact: boolean; children: React.ReactNode }) {
  return (
    <section
      aria-labelledby="learning-section"
      className={`rounded-2xl border border-border bg-card/90 ${compact ? "p-5" : "p-5 sm:p-6"}`}
    >
      <h2 id="learning-section" className="sr-only">
        Learning from your choices
      </h2>
      {children}
    </section>
  );
}
