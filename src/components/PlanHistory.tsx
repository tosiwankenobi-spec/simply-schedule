import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { History, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deletePlanRun, listPlanRuns, previewPlanUndo, undoPlanRun } from "@/lib/replan.functions";
import { PLAN_HISTORY_RETENTION_DAYS } from "@/lib/plan-history";

const timeLabel = (value: string) => format(new Date(value), "h:mm a");

export const planHistoryKey = ["plan-runs"] as const;

export function PlanHistory() {
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);

  const runs = useQuery({
    queryKey: planHistoryKey,
    queryFn: () => listPlanRuns(),
    staleTime: 30_000,
  });

  const undoPreview = useQuery({
    queryKey: ["plan-undo-preview", openId],
    queryFn: () => previewPlanUndo({ data: { planRunId: openId as string } }),
    enabled: Boolean(openId),
  });

  const refreshSchedule = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["appointments"] }),
      queryClient.invalidateQueries({ queryKey: ["day-replan-preview"] }),
      queryClient.invalidateQueries({ queryKey: ["morning-plan"] }),
      queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      queryClient.invalidateQueries({ queryKey: planHistoryKey }),
    ]);

  const undo = useMutation({
    mutationFn: (planRunId: string) => undoPlanRun({ data: { planRunId } }),
    onSuccess: async ({ restored, skipped, repeated }) => {
      toast.success(
        repeated
          ? "That plan had already been undone."
          : skipped > 0
            ? `Put back ${restored} block${restored === 1 ? "" : "s"} · ${skipped} left alone`
            : `Put back ${restored} block${restored === 1 ? "" : "s"}`,
      );
      setOpenId(null);
      await refreshSchedule();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "That plan could not be undone."),
  });

  const remove = useMutation({
    mutationFn: (planRunId: string) => deletePlanRun({ data: { planRunId } }),
    onSuccess: async () => {
      toast.success("History entry deleted");
      setOpenId(null);
      await queryClient.invalidateQueries({ queryKey: planHistoryKey });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "That entry could not be deleted."),
  });

  const entries = runs.data ?? [];

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
      <div className="px-5 py-4">
        <h2 className="flex items-center gap-2 font-serif text-lg text-foreground">
          <History className="h-4 w-4 text-accent" /> Recent plans
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every applied plan can be undone. Entries are kept for {PLAN_HISTORY_RETENTION_DAYS} days,
          then removed automatically.
        </p>
      </div>

      {runs.isLoading && (
        <div className="h-16 animate-pulse border-t border-border bg-secondary/30" />
      )}
      {runs.isError && (
        <p className="border-t border-border px-5 py-4 text-sm text-destructive">
          Your plan history couldn't be loaded. Please try again.
        </p>
      )}
      {runs.isSuccess && entries.length === 0 && (
        <p className="border-t border-border px-5 py-4 text-sm text-muted-foreground">
          No plans applied yet. Once you approve a replan it will appear here.
        </p>
      )}

      {entries.length > 0 && (
        <ul className="divide-y divide-border border-t border-border">
          {entries.map((run) => {
            const open = openId === run.id;
            return (
              <li key={run.id} className="px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {format(new Date(run.appliedAt), "EEE d MMM, h:mm a")}
                      {run.undoneAt && (
                        <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
                          undone
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{run.summary}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      aria-expanded={open}
                      onClick={() => setOpenId(open ? null : run.id)}
                    >
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                      {open ? "Close" : "Undo…"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete history entry from ${format(new Date(run.appliedAt), "d MMM h:mm a")}`}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(run.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {open && (
                  <div
                    className="mt-3 rounded-xl border border-border bg-secondary/20 p-3"
                    aria-live="polite"
                  >
                    {undoPreview.isLoading && (
                      <p className="text-xs text-muted-foreground">
                        Checking what can be put back…
                      </p>
                    )}
                    {undoPreview.isError && (
                      <p className="text-xs text-destructive">
                        This plan couldn't be checked. Please try again.
                      </p>
                    )}
                    {undoPreview.data && (
                      <>
                        <ul className="space-y-2">
                          {undoPreview.data.lines.map((line) => (
                            <li key={line.change.appointmentId} className="text-xs">
                              <p className="truncate font-medium text-foreground">
                                {line.change.title}
                              </p>
                              <p className="text-muted-foreground">
                                {timeLabel(line.change.toStart)} →{" "}
                                {timeLabel(line.change.fromStart)} · {line.explanation}
                              </p>
                            </li>
                          ))}
                        </ul>
                        {undoPreview.data.counts.changedSince + undoPreview.data.counts.missing >
                          0 && (
                          <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700">
                            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            Some blocks changed after this plan, so they will be left exactly as
                            they are.
                          </p>
                        )}
                        <Button
                          className="mt-3 w-full bg-foreground text-background hover:bg-foreground/90 sm:w-auto"
                          disabled={undo.isPending || undoPreview.data.counts.restore === 0}
                          onClick={() => undo.mutate(run.id)}
                        >
                          {undoPreview.data.counts.restore === 0
                            ? "Nothing to put back"
                            : undo.isPending
                              ? "Putting back…"
                              : `Put back ${undoPreview.data.counts.restore} block${
                                  undoPreview.data.counts.restore === 1 ? "" : "s"
                                }`}
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
