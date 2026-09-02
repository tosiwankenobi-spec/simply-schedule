import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { ArrowRight, CalendarClock, Clock3, LocateFixed, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { recommendNow } from "@/lib/now.functions";

export function NowRecommendation() {
  const recommendation = useMutation({
    mutationFn: () =>
      recommendNow({
        data: { timezoneOffsetMinutes: new Date().getTimezoneOffset() },
      }),
  });

  const result = recommendation.data;

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-accent/35 bg-card">
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-serif text-lg text-foreground">
            <LocateFixed className="h-4 w-4 text-accent" /> What should I do now?
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Get one realistic next action from your schedule and priorities.
          </p>
        </div>
        <Button
          size="sm"
          className="shrink-0 bg-accent text-accent-foreground hover:bg-accent/90"
          disabled={recommendation.isPending}
          onClick={() => recommendation.mutate()}
        >
          <Sparkles className="mr-1.5 h-4 w-4" />
          {recommendation.isPending ? "Choosing…" : result ? "Refresh" : "Choose"}
        </Button>
      </div>

      {recommendation.isError && (
        <div className="border-t border-border px-5 py-4 text-sm text-destructive">
          Chronos-V couldn't choose a next action. Please try again.
        </div>
      )}

      {result && (
        <div className="border-t border-border bg-accent/5 px-5 py-4" aria-live="polite">
          <p className="text-xs font-medium uppercase tracking-wide text-accent">
            {result.kind === "task"
              ? "Best next task"
              : result.kind === "appointment"
                ? "Focus here now"
                : "Your window is clear"}
          </p>
          <p className="mt-1 font-serif text-xl text-foreground">{result.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{result.reason}</p>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            {result.kind === "task" && (
              <>
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 className="h-3.5 w-3.5" /> {result.estimatedMinutes} min task
                </span>
                <span>{result.availableMinutes} min available</span>
                {result.nextCommitment && <span>Before {result.nextCommitment}</span>}
              </>
            )}
            {result.kind === "appointment" && (
              <>
                <span className="inline-flex items-center gap-1.5">
                  <CalendarClock className="h-3.5 w-3.5" />
                  {format(new Date(result.startsAt), "h:mm a")}
                </span>
                {result.location && <span>{result.location}</span>}
              </>
            )}
            {result.kind === "clear" && result.availableMinutes > 0 && (
              <span>{result.availableMinutes} min available</span>
            )}
          </div>

          {result.kind === "task" && (
            <Button asChild variant="link" className="mt-2 h-auto p-0 text-accent">
              <Link to="/tasks">
                Open tasks <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
