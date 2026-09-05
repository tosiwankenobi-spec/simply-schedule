import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertTriangle,
  Check,
  Clock,
  MoveRight,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { applyDayReplan, previewDayReplan, undoPlanRun } from "@/lib/replan.functions";
import { planHistoryKey } from "@/components/PlanHistory";

const STALE_AFTER_MS = 5 * 60 * 1000;

function timeLabel(value: string) {
  return format(new Date(value), "h:mm a");
}

export function DayReplanner() {
  const queryClient = useQueryClient();
  const date = format(new Date(), "yyyy-MM-dd");
  const timezoneOffsetMinutes = new Date().getTimezoneOffset();
  const [excluded, setExcluded] = useState<string[]>([]);
  const [lastRunId, setLastRunId] = useState<string | null>(null);

  const preview = useQuery({
    queryKey: ["day-replan-preview", date, timezoneOffsetMinutes],
    queryFn: () => previewDayReplan({ data: { date, timezoneOffsetMinutes } }),
    staleTime: 30_000,
  });
  const result = preview.data;

  // A fresh proposal always starts with every flexible move selected.
  useEffect(() => {
    setExcluded([]);
  }, [result?.generatedAt]);

  const selectedMoves = useMemo(
    () => (result?.moves ?? []).filter((move) => !excluded.includes(move.appointmentId)),
    [result?.moves, excluded],
  );

  const [isStale, setIsStale] = useState(false);
  useEffect(() => {
    if (!result?.generatedAt) return;
    setIsStale(false);
    const age = Date.now() - Date.parse(result.generatedAt);
    const timer = window.setTimeout(() => setIsStale(true), Math.max(0, STALE_AFTER_MS - age));
    return () => window.clearTimeout(timer);
  }, [result?.generatedAt]);

  const refreshSchedule = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["appointments"] }),
      queryClient.invalidateQueries({ queryKey: ["day-replan-preview"] }),
      queryClient.invalidateQueries({ queryKey: ["morning-plan"] }),
      queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["now-recommendation"] }),
      queryClient.invalidateQueries({ queryKey: ["next-travel-guidance"] }),
      queryClient.invalidateQueries({ queryKey: planHistoryKey }),
    ]);

  const apply = useMutation({
    mutationFn: () => {
      if (!result) throw new Error("Check your day again before approving.");
      if (!selectedMoves.length) throw new Error("Select at least one block to move.");
      // The whole signed proposal goes back with the blocks that were ticked,
      // so the server can prove it is unchanged before anything moves.
      return applyDayReplan({
        data: {
          date,
          timezoneOffsetMinutes,
          previewId: result.previewId,
          signature: result.signature,
          generatedAt: result.generatedAt,
          moves: result.moves,
          approvedIds: selectedMoves.map((move) => move.appointmentId),
        },
      });
    },
    onSuccess: async ({ moved, planRunId, repeated }) => {
      setLastRunId(planRunId);
      toast.success(
        repeated
          ? "That plan was already applied — nothing moved twice."
          : `Replanned ${moved} task block${moved === 1 ? "" : "s"}`,
      );
      await preview.refetch();
      await refreshSchedule();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "The proposal could not be applied.");
    },
  });

  const undo = useMutation({
    mutationFn: (planRunId: string) => undoPlanRun({ data: { planRunId } }),
    onSuccess: async ({ restored, skipped, repeated }) => {
      setLastRunId(null);
      toast.success(
        repeated
          ? "That plan had already been undone."
          : skipped > 0
          ? `Put back ${restored} block${restored === 1 ? "" : "s"} · ${skipped} left alone`
          : `Put back ${restored} block${restored === 1 ? "" : "s"}`,
      );
      await refreshSchedule();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "That plan could not be undone."),
  });

  const busy = preview.isFetching || apply.isPending || undo.isPending;

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-serif text-lg text-foreground">
            <RefreshCw className="h-4 w-4 text-accent" /> Automatic replanning
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Flexible task blocks can move. Appointments, shared commitments, travel and preparation
            time stay protected.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={busy}
          onClick={() => preview.refetch()}
        >
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${preview.isFetching ? "animate-spin" : ""}`} />
          Check
        </Button>
      </div>

      {preview.isLoading && (
        <div className="h-20 animate-pulse border-t border-border bg-secondary/30" />
      )}
      {preview.isError && (
        <div className="border-t border-border px-4 py-4 text-sm text-destructive sm:px-5">
          Chronos-V couldn't check your day. Please try again.
        </div>
      )}

      {result && result.affectedCount === 0 && (
        <div className="flex items-start gap-3 border-t border-border bg-emerald-500/5 px-4 py-4 sm:px-5">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <div>
            <p className="text-sm font-medium text-foreground">Your day is already balanced</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              No missed or conflicting task blocks need to move.
            </p>
          </div>
        </div>
      )}

      {result && result.affectedCount > 0 && (
        <div className="border-t border-border px-4 py-4 sm:px-5" aria-live="polite">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <div>
              <p className="text-sm font-medium text-foreground">
                Proposed update · {result.moves.length} move{result.moves.length === 1 ? "" : "s"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Nothing changes until you approve. {result.fixedCount} protected commitment
                {result.fixedCount === 1 ? "" : "s"} stay exactly where they are.
              </p>
            </div>
          </div>

          {isStale && (
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700">
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              This proposal was worked out a few minutes ago. Check again for up-to-date times.
            </p>
          )}

          {result.moves.length > 0 && (
            <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
              {result.moves.map((move) => {
                const included = !excluded.includes(move.appointmentId);
                return (
                  <li key={move.appointmentId} className="flex items-start gap-3 px-3 py-3">
                    <Checkbox
                      id={`replan-${move.appointmentId}`}
                      className="mt-0.5"
                      checked={included}
                      onCheckedChange={(checked) =>
                        setExcluded((current) =>
                          checked === true
                            ? current.filter((id) => id !== move.appointmentId)
                            : [...current, move.appointmentId],
                        )
                      }
                    />
                    <label
                      htmlFor={`replan-${move.appointmentId}`}
                      className="min-w-0 flex-1 cursor-pointer"
                    >
                      <span className="block truncate text-sm text-foreground">{move.title}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="line-through">{timeLabel(move.fromStart)}</span>
                        <MoveRight className="h-3.5 w-3.5 text-accent" />
                        <span className="font-medium text-foreground">
                          {timeLabel(move.toStart)}–{timeLabel(move.toEnd)}
                        </span>
                        <span>·</span>
                        <span>
                          {move.reason === "missed"
                            ? "the time you had set has already passed"
                            : `overlapped ${move.conflictsWith ?? "a protected commitment"}`}
                        </span>
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px]">
                          flexible
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          {result.unresolved.length > 0 && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {result.unresolved.length} task block{result.unresolved.length === 1 ? "" : "s"}{" "}
                couldn't fit safely today and will remain unchanged.
              </span>
            </div>
          )}

          {result.moves.length > 0 && (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Button
                className="w-full bg-foreground text-background hover:bg-foreground/90 sm:w-auto"
                disabled={busy || selectedMoves.length === 0}
                onClick={() => apply.mutate()}
              >
                {apply.isPending
                  ? "Applying…"
                  : selectedMoves.length === 0
                    ? "Select a block to move"
                    : `Approve ${selectedMoves.length} of ${result.moves.length}`}
              </Button>
              <Button
                variant="ghost"
                className="w-full sm:w-auto"
                disabled={busy}
                onClick={() => setExcluded(result.moves.map((move) => move.appointmentId))}
              >
                Cancel all
              </Button>
            </div>
          )}
          {apply.isError && (
            <p className="mt-3 text-xs text-destructive">
              Nothing was changed. Check your day again for a fresh proposal.
            </p>
          )}
        </div>
      )}

      {lastRunId && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-secondary/20 px-4 py-3 sm:px-5">
          <p className="text-xs text-muted-foreground">Changed your mind about the last plan?</p>
          <Button
            variant="outline"
            size="sm"
            disabled={undo.isPending}
            onClick={() => undo.mutate(lastRunId)}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            {undo.isPending ? "Undoing…" : "Undo last plan"}
          </Button>
        </div>
      )}
    </section>
  );
}
