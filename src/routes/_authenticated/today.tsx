import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isSameDay, differenceInMinutes } from "date-fns";
import { listTasks, setTaskStatus } from "@/lib/tasks.functions";
import {
  eventEnd,
  eventStart,
  eventsOnDay,
  upcomingEvents,
  useScheduleEvents,
} from "@/lib/schedule-hub";
import { AllDayBadge, CommitmentBadge, SourceBadge } from "@/components/ScheduleBadges";
import { Button } from "@/components/ui/button";
import { SyncAlert } from "@/components/SyncAlert";
import { NotificationBell } from "@/components/NotificationBell";
import { TaskNudge } from "@/components/TaskNudge";
import { NowRecommendation } from "@/components/NowRecommendation";
import { DayReplanner } from "@/components/DayReplanner";
import { TravelGuidanceCard } from "@/components/TravelGuidance";
import { MorningPlanner } from "@/components/MorningPlanner";
import { QuickCapture } from "@/components/QuickCapture";
import { CalendarDays, CheckCircle2, Circle, Clock, ListTodo, MapPin, Moon } from "lucide-react";

export const Route = createFileRoute("/_authenticated/today")({
  component: TodayPage,
  head: () => ({
    meta: [
      { title: "Today · Chronos-V" },
      {
        name: "description",
        content:
          "Your best next action, upcoming appointments and one-tap capture for anything new.",
      },
      { property: "og:title", content: "Today · Chronos-V" },
      {
        property: "og:description",
        content: "Your best next action, appointments and quick capture.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function TodayPage() {
  const now = new Date();

  const { data: events, isLoading, isError, error, refetch } = useScheduleEvents();

  const { data: tasks } = useQuery({ queryKey: ["tasks"], queryFn: () => listTasks() });

  const list = events ?? [];
  const next = upcomingEvents(list, now).find((event) => !event.is_all_day) ?? null;
  const todayList = eventsOnDay(list, now);
  const today = format(now, "yyyy-MM-dd");
  const overdue = (tasks ?? []).filter(
    (task) => task.status !== "done" && task.deadline && task.deadline < today,
  );

  return (
    <div className="verolane-wash relative min-h-screen bg-background">
      <div className="pointer-events-none absolute inset-0 paper-grain opacity-20" />
      <div className="relative mx-auto max-w-[1180px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <header className="flex items-center justify-between gap-4 border-b border-border/70 pb-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
              Your personal operating system
            </p>
            <h1 className="mt-1 font-serif text-3xl text-foreground sm:text-4xl">
              Your day. <span className="text-accent">Planned.</span>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{format(now, "EEEE, MMMM d")}</p>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <Button
              asChild
              variant="outline"
              size="sm"
              className="hidden bg-card/70 text-muted-foreground sm:inline-flex"
            >
              <Link to="/app">
                <CalendarDays className="mr-1 h-4 w-4" /> Full timeline
              </Link>
            </Button>
          </div>
        </header>

        <SyncAlert />

        <div className="mt-2 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <main className="min-w-0">
            <NowRecommendation />

            <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-card/90">
              <div className="border-b border-border px-5 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Up next
                </p>
              </div>
              {isLoading ? (
                <div className="h-28 animate-pulse bg-secondary/40" />
              ) : isError ? (
                <div className="px-5 py-5 text-sm">
                  <p className="text-foreground">Couldn't load your schedule.</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {error instanceof Error ? error.message : "Unknown error"}
                  </p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
                    Try again
                  </Button>
                </div>
              ) : next ? (
                <div className="grid gap-4 px-5 py-5 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate font-serif text-2xl text-foreground">{next.title}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5" />
                        {format(eventStart(next), "h:mm a")}
                        {next.ends_at ? ` – ${format(eventEnd(next), "h:mm a")}` : ""}
                      </span>
                      {next.location ? (
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5" /> {next.location}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <SourceBadge event={next} />
                      <CommitmentBadge event={next} />
                    </div>
                  </div>
                  <p className="rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-accent">
                    {relativeLabel(now, eventStart(next))}
                  </p>
                </div>
              ) : (
                <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                  Nothing left on the calendar.
                </p>
              )}
            </section>

            <section className="mt-8">
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
                    Timeline
                  </p>
                  <h2 className="mt-1 font-serif text-2xl text-foreground">Today’s rhythm</h2>
                </div>
                <span className="text-xs text-muted-foreground">
                  {todayList.length} commitment{todayList.length === 1 ? "" : "s"}
                </span>
              </div>
              {isLoading ? (
                <div className="space-y-3">
                  <div className="h-20 animate-pulse rounded-2xl border border-border bg-card" />
                  <div className="h-20 animate-pulse rounded-2xl border border-border bg-card" />
                </div>
              ) : todayList.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border bg-card/45 px-5 py-10 text-center text-sm text-muted-foreground">
                  Your timeline is open today.
                </p>
              ) : (
                <ol className="space-y-3">
                  {todayList.map((appointment) => (
                    <li
                      key={appointment.id}
                      className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3"
                    >
                      <time className="pt-4 text-right text-xs font-medium text-muted-foreground">
                        {appointment.is_all_day
                          ? "All day"
                          : format(eventStart(appointment), "h:mm")}
                      </time>
                      <div
                        className={`relative rounded-2xl border border-l-[3px] bg-card px-4 py-3.5 shadow-[0_8px_30px_rgba(0,46,40,0.035)] ${
                          appointment.commitment_type === "flexible"
                            ? "border-l-accent"
                            : "border-l-ink/45"
                        }`}
                      >
                        <span className="block truncate font-medium text-foreground">
                          {appointment.title}
                        </span>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {!appointment.is_all_day ? (
                            <span>
                              {format(eventStart(appointment), "h:mm a")}
                              {appointment.ends_at
                                ? ` – ${format(eventEnd(appointment), "h:mm a")}`
                                : ""}
                            </span>
                          ) : null}
                          {appointment.location ? (
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="h-3 w-3" /> {appointment.location}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <SourceBadge event={appointment} />
                          <CommitmentBadge event={appointment} />
                          {appointment.is_all_day ? <AllDayBadge /> : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <OverdueSection items={overdue} />
          </main>

          <aside className="min-w-0 xl:sticky xl:top-6">
            <div className="hidden xl:block [&>section]:mt-4">
              <QuickCapture />
            </div>
            <div className="[&>section]:mt-4">
              <MorningPlanner />
            </div>
            <div className="[&>section]:mt-4">
              <TravelGuidanceCard />
            </div>
            <div className="[&>section]:mt-4">
              <DayReplanner />
            </div>
            <div className="mt-4">
              <TaskNudge />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl border border-border bg-card/75 p-2">
              <Button asChild variant="ghost">
                <Link to="/tasks">
                  <ListTodo className="mr-1.5 h-4 w-4" /> Backlog
                </Link>
              </Button>
              <Button asChild variant="ghost">
                <Link to="/tomorrow">
                  <Moon className="mr-1.5 h-4 w-4" /> Tomorrow
                </Link>
              </Button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function relativeLabel(now: Date, start: Date) {
  const mins = differenceInMinutes(start, now);
  if (mins < 0) return "Happening now";
  if (mins < 60) return `In ${mins} minute${mins === 1 ? "" : "s"}`;
  const hrs = Math.round(mins / 60);
  if (isSameDay(now, start)) return `In about ${hrs} hour${hrs === 1 ? "" : "s"}`;
  return format(start, "EEE, MMM d");
}

function OverdueSection({ items }: { items: Awaited<ReturnType<typeof listTasks>> }) {
  const qc = useQueryClient();
  if (items.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-destructive">
        Overdue · {items.length}
      </h2>
      <ul className="space-y-2">
        {items.map((t) => (
          <li
            key={t.id}
            className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3"
          >
            <button
              aria-label="Mark done"
              className="mt-0.5 text-muted-foreground hover:text-accent"
              onClick={async () => {
                await setTaskStatus({ data: { id: t.id, status: "done" } });
                qc.invalidateQueries({ queryKey: ["tasks"] });
              }}
            >
              <Circle className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-foreground">{t.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Due {t.deadline ? format(new Date(`${t.deadline}T00:00:00`), "MMM d") : "—"} ·{" "}
                {t.estimated_min}m
              </p>
            </div>
            <CheckCircle2 className="mt-0.5 h-4 w-4 text-transparent" />
          </li>
        ))}
      </ul>
    </section>
  );
}
