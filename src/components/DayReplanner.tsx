import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, Check, MoveRight, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { applyDayReplan, previewDayReplan } from "@/lib/replan.functions";

function timeLabel(value: string) {
  return format(new Date(value), "h:mm a");
}

export function DayReplanner() {
  const queryClient = useQueryClient();
  const date = format(new Date(), "yyyy-MM-dd");
  const timezoneOffsetMinutes = new Date().getTimezoneOffset();
  const preview = useQuery({
    queryKey: ["day-replan-preview", date, timezoneOffsetMinutes],
    queryFn: () => previewDayReplan({ data: { date, timezoneOffsetMinutes } }),
    staleTime: 30_000,
  });
  const apply = useMutation({
    mutationFn: () => {
      if (!preview.data?.moves.length) throw new Error("No moves to apply.");
      return applyDayReplan({
        data: { date, timezoneOffsetMinutes, moves: preview.data.moves },
      });
    },
    onSuccess: async ({ moved }) => {
      toast.success(`Replanned ${moved} task block${moved === 1 ? "" : "s"}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["appointments"] }),
        queryClient.invalidateQueries({ queryKey: ["day-replan-preview"] }),
        queryClient.invalidateQueries({ queryKey: ["morning-plan"] }),
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["now-recommendation"] }),
        queryClient.invalidateQueries({ queryKey: ["next-travel-guidance"] }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "The proposal could not be applied.");
    },
  });
  const result = preview.data;

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-start justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-serif text-lg text-foreground">
            <RefreshCw className="h-4 w-4 text-accent" /> Automatic replanning
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Flexible task blocks can move. Appointments, shared commitments, travel and preparation
            time stay protected.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={preview.isFetching || apply.isPending}
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
        <div className="border-t border-border px-5 py-4 text-sm text-destructive">
          Chronos-V couldn't check your day. Please try again.
        </div>
      )}

      {result && result.affectedCount === 0 && (
        <div className="flex items-start gap-3 border-t border-border bg-emerald-500/5 px-5 py-4">
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
        <div className="border-t border-border px-5 py-4" aria-live="polite">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <div>
              <p className="text-sm font-medium text-foreground">
                Proposed update · {result.moves.length} move{result.moves.length === 1 ? "" : "s"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Review first. Nothing changes until you approve.
              </p>
            </div>
          </div>

          {result.moves.length > 0 && (
            <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
              {result.moves.map((move) => (
                <li key={move.appointmentId} className="px-3 py-3">
                  <p className="truncate text-sm text-foreground">{move.title}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{timeLabel(move.fromStart)}</span>
                    <MoveRight className="h-3.5 w-3.5 text-accent" />
                    <span>{timeLabel(move.toStart)}</span>
                    <span>·</span>
                    <span>
                      {move.reason === "missed"
                        ? "missed earlier"
                        : `conflicted with ${move.conflictsWith ?? "a fixed commitment"}`}
                    </span>
                  </p>
                </li>
              ))}
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
            <Button
              className="mt-4 w-full bg-foreground text-background hover:bg-foreground/90"
              disabled={apply.isPending || preview.isFetching}
              onClick={() => apply.mutate()}
            >
              {apply.isPending
                ? "Applying…"
                : `Approve ${result.moves.length} move${result.moves.length === 1 ? "" : "s"}`}
            </Button>
          )}
          {apply.isError && (
            <p className="mt-3 text-xs text-destructive">
              Nothing else will move until you check your day again.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
