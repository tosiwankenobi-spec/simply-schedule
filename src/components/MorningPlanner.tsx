import { useEffect, useState } from "react";
import { format } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Sunrise, WandSparkles } from "lucide-react";
import { autoScheduleTasks } from "@/lib/tasks.functions";
import { WhyTheseBlocks } from "@/components/WhyTheseBlocks";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type LocalClock = { date: string; timezoneOffsetMinutes: number };

function readLocalClock(): LocalClock {
  const now = new Date();
  return {
    date: format(now, "yyyy-MM-dd"),
    timezoneOffsetMinutes: now.getTimezoneOffset(),
  };
}

export function MorningPlanner() {
  const queryClient = useQueryClient();
  const [clock, setClock] = useState<LocalClock | null>(null);

  useEffect(() => {
    const refreshClock = () => {
      const next = readLocalClock();
      setClock((current) =>
        current?.date === next.date && current.timezoneOffsetMinutes === next.timezoneOffsetMinutes
          ? current
          : next,
      );
    };
    refreshClock();
    const timer = window.setInterval(refreshClock, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const plan = useQuery({
    queryKey: ["morning-plan", clock?.date, clock?.timezoneOffsetMinutes],
    queryFn: () =>
      autoScheduleTasks({
        data: {
          date: clock!.date,
          dryRun: true,
          tzOffsetMin: clock!.timezoneOffsetMinutes,
        },
      }),
    enabled: Boolean(clock),
    staleTime: 60_000,
  });

  const apply = useMutation({
    mutationFn: () =>
      autoScheduleTasks({
        data: {
          date: clock!.date,
          dryRun: false,
          tzOffsetMin: clock!.timezoneOffsetMinutes,
        },
      }),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["morning-plan"] }),
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["appointments"] }),
        queryClient.invalidateQueries({ queryKey: ["now-recommendation"] }),
        queryClient.invalidateQueries({ queryKey: ["day-replan-preview"] }),
      ]);
      toast.success(
        `Scheduled ${result.placements.length} task${result.placements.length === 1 ? "" : "s"}`,
      );
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Couldn't apply today's plan"),
  });

  if (!clock || plan.isPending) {
    return (
      <section className="mt-4 rounded-xl border border-border bg-card px-4 py-4">
        <p className="text-sm text-muted-foreground">Building today’s realistic plan…</p>
      </section>
    );
  }

  if (plan.isError) {
    return (
      <section className="mt-4 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-4">
        <p className="text-sm text-foreground">Today’s plan couldn’t be built.</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={() => plan.refetch()}>
          Try again
        </Button>
      </section>
    );
  }

  const result = plan.data;
  if (!result) return null;

  return (
    <section className="mt-4 rounded-xl border border-accent/30 bg-card px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="inline-flex items-center gap-2 font-serif text-lg">
            <Sunrise className="h-4 w-4 text-accent" /> Today’s plan
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Built from deadlines, priorities, working hours, free gaps and travel time.
          </p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/tasks">Tasks</Link>
        </Button>
      </div>

      {result.placements.length > 0 ? (
        <>
          <ul className="mt-4 space-y-2">
            {result.placements.map((placement) => (
              <li
                key={placement.task_id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="min-w-0 truncate text-foreground">{placement.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {format(new Date(placement.starts_at), "h:mm a")}–
                  {format(new Date(placement.ends_at), "h:mm a")}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <WhyTheseBlocks result={result} />
          </div>
          <Button
            className="mt-4 w-full bg-accent text-accent-foreground hover:bg-accent/90"
            disabled={apply.isPending}
            onClick={() => apply.mutate()}
          >
            <WandSparkles className="mr-1.5 h-4 w-4" />
            {apply.isPending ? "Checking the latest gaps…" : "Approve and schedule this plan"}
          </Button>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          {result.unplaced.length > 0
            ? "Your open tasks do not fit the remaining working-time gaps today."
            : "No open tasks need a time block today."}
        </p>
      )}
    </section>
  );
}
