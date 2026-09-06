import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock3, Gauge, ListTodo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCapacityForecast } from "@/lib/capacity-forecast.functions";
import {
  formatMinutes,
  normalizeTimeZone,
  type ForecastDeadline,
  type ForecastStatus,
} from "@/lib/capacity-forecast";

const capacityForecastKey = ["capacity-forecast"] as const;

const STATUS_LABEL: Record<ForecastStatus, string> = {
  critical: "At risk",
  tight: "Tight",
  "on-track": "On track",
};

const STATUS_CLASS: Record<ForecastStatus, string> = {
  critical: "border-destructive/40 bg-destructive/10 text-destructive",
  tight: "border-gold/50 bg-gold/10 text-foreground",
  "on-track": "border-border bg-secondary text-muted-foreground",
};

function StatusIcon({ status }: { status: ForecastStatus }) {
  if (status === "critical") return <AlertTriangle className="h-3.5 w-3.5" aria-hidden />;
  if (status === "tight") return <Clock3 className="h-3.5 w-3.5" aria-hidden />;
  return <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />;
}

/** Text label plus icon — status is never conveyed by colour alone. */
function StatusChip({ status }: { status: ForecastStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[status]}`}
    >
      <StatusIcon status={status} />
      {STATUS_LABEL[status]}
    </span>
  );
}

function dayLabel(date: string) {
  return format(parseISO(`${date}T00:00:00`), "EEE d");
}

export function CapacityForecast() {
  const timeZone = normalizeTimeZone(
    typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined,
  );

  const forecast = useQuery({
    queryKey: [...capacityForecastKey, timeZone],
    queryFn: () => getCapacityForecast({ data: { timeZone } }),
    staleTime: 5 * 60_000,
  });

  return (
    <section
      aria-labelledby="capacity-forecast-heading"
      className="overflow-hidden rounded-2xl border border-border bg-card/90"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-accent" aria-hidden />
          <h2
            id="capacity-forecast-heading"
            className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
          >
            Capacity forecast · next 14 days
          </h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => forecast.refetch()}
          disabled={forecast.isFetching}
        >
          {forecast.isFetching ? "Checking…" : "Refresh"}
        </Button>
      </div>

      {forecast.isLoading ? (
        <div className="space-y-3 px-5 py-5" aria-busy="true">
          <div className="h-5 w-2/3 animate-pulse rounded bg-secondary" />
          <div className="h-16 animate-pulse rounded bg-secondary/70" />
        </div>
      ) : forecast.isError ? (
        <div className="px-5 py-5 text-sm">
          <p className="text-foreground">Your forecast couldn't be worked out.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {forecast.error instanceof Error ? forecast.error.message : "Unknown problem"}
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => forecast.refetch()}>
            Try again
          </Button>
        </div>
      ) : !forecast.data ? null : (
        <div className="px-5 py-5">
          <p className="font-serif text-xl leading-7 text-foreground">{forecast.data.headline}</p>

          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-background/60 px-3 py-2">
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Time available
              </dt>
              <dd className="mt-0.5 font-medium text-foreground">
                {formatMinutes(forecast.data.totalCapacityMinutes)}
              </dd>
            </div>
            <div className="rounded-xl border border-border bg-background/60 px-3 py-2">
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Work waiting
              </dt>
              <dd className="mt-0.5 font-medium text-foreground">
                {formatMinutes(forecast.data.requiredMinutes)}
              </dd>
            </div>
            <div className="col-span-2 rounded-xl border border-border bg-background/60 px-3 py-2 sm:col-span-1">
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Deadlines needing attention
              </dt>
              <dd className="mt-0.5 font-medium text-foreground">
                {forecast.data.counts.critical} at risk · {forecast.data.counts.tight} tight
              </dd>
            </div>
          </dl>

          {forecast.data.firstOverloadedDate ? (
            <p className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-foreground">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
              <span>
                Your plan runs out of room on{" "}
                <strong>{dayLabel(forecast.data.firstOverloadedDate)}</strong> — work due by then
                needs more time than you have.
              </span>
            </p>
          ) : null}

          <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Day by day
          </h3>
          <ul className="mt-2 grid grid-cols-7 gap-1.5 sm:grid-cols-14">
            {forecast.data.days.map((day) => {
              const used =
                day.capacityMinutes > 0
                  ? Math.min(100, Math.round((day.allocatedMinutes / day.capacityMinutes) * 100))
                  : 100;
              return (
                <li key={day.date} className="min-w-0">
                  <div
                    className="flex h-16 flex-col justify-end rounded-lg border border-border bg-background/60 p-1"
                    role="img"
                    aria-label={`${dayLabel(day.date)}: ${formatMinutes(day.freeMinutes)} free of ${formatMinutes(day.capacityMinutes)}${day.isFull ? ", full" : ""}`}
                    title={`${dayLabel(day.date)} · ${formatMinutes(day.freeMinutes)} free of ${formatMinutes(day.capacityMinutes)}`}
                  >
                    <div
                      className={`w-full rounded ${day.isFull ? "bg-destructive/70" : "bg-accent/70"}`}
                      style={{ height: `${Math.max(4, used)}%` }}
                    />
                  </div>
                  <p className="mt-1 truncate text-center text-[10px] text-muted-foreground">
                    {dayLabel(day.date)}
                  </p>
                </li>
              );
            })}
          </ul>

          <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Deadlines needing attention
          </h3>
          {forecast.data.deadlines.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Nothing with a deadline in the next 14 days.
            </p>
          ) : (
            <ol className="mt-2 space-y-2">
              {forecast.data.deadlines.slice(0, 5).map((item) => (
                <DeadlineRow key={item.taskId} item={item} />
              ))}
            </ol>
          )}

          {forecast.data.backlog.length > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Plus {forecast.data.backlog.length} item
              {forecast.data.backlog.length === 1 ? "" : "s"} with no deadline (
              {formatMinutes(forecast.data.backlog.reduce((s, b) => s + b.estimatedMin, 0))}).
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/tasks">
                <ListTodo className="mr-1.5 h-4 w-4" aria-hidden /> Review tasks
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/planner">Open planner</Link>
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            This forecast only looks — nothing is moved or booked until you approve a plan.
          </p>
        </div>
      )}
    </section>
  );
}

function DeadlineRow({ item }: { item: ForecastDeadline }) {
  return (
    <li className="rounded-xl border border-border bg-background/60 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{item.title}</p>
        <StatusChip status={item.status} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Due {dayLabel(item.deadline)} · needs {formatMinutes(item.estimatedMin)}
        {item.shortfallMinutes > 0
          ? ` · ${formatMinutes(item.shortfallMinutes)} short`
          : ` · ${formatMinutes(item.slackMinutes)} spare`}
      </p>
      {item.reasons.length > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">{item.reasons[0]}</p>
      ) : null}
    </li>
  );
}
