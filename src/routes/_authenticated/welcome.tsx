import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  ListTodo,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getWelcomeProgress } from "@/lib/welcome.functions";

export const Route = createFileRoute("/_authenticated/welcome")({
  component: WelcomePage,
  head: () => ({
    meta: [
      { title: "Welcome · Chronos-V" },
      {
        name: "description",
        content: "Set up your working rhythm, calendar connections, and first Chronos-V plan.",
      },
    ],
  }),
});

const SETUP_STEPS = [
  {
    number: "01",
    icon: Clock3,
    title: "Set your working rhythm",
    description: "Choose when you work best, how often you need breaks, and where lunch belongs.",
    action: "Choose working hours",
    reviewAction: "Review working hours",
    to: "/planner/preferences" as const,
    note: "Helps the AI build plans that feel realistic.",
    readyNote: "Standard working hours are ready. Review them whenever your rhythm changes.",
    progressKey: "rhythmReady" as const,
  },
  {
    number: "02",
    icon: CalendarDays,
    title: "Bring your calendars together",
    description:
      "Connect Google Calendar or import a calendar file. You decide exactly what flows in.",
    action: "Connect a calendar",
    reviewAction: "Review calendar setup",
    to: "/setup/sync" as const,
    note: "Optional—you can also create everything manually.",
    readyNote: "A calendar source is ready for planning.",
    progressKey: "calendarReady" as const,
  },
  {
    number: "03",
    icon: ListTodo,
    title: "Capture what matters next",
    description:
      "Add one task or deadline. Chronos-V can then find a real place for it in your day.",
    action: "Add your first task",
    reviewAction: "Open your tasks",
    to: "/tasks" as const,
    note: "Start small. One meaningful priority is enough.",
    readyNote: "Your first priority is ready to schedule.",
    progressKey: "taskCaptured" as const,
  },
] as const;

const OUTCOMES = [
  "Fixed commitments stay protected",
  "Flexible work fills the right gaps",
  "Your plan can recover when life changes",
] as const;

function WelcomePage() {
  const progress = useQuery({
    queryKey: ["welcome-progress"],
    queryFn: () => getWelcomeProgress(),
    retry: false,
  });
  const completed = progress.data?.completed ?? 0;
  const allReady = completed === 3;
  const firstIncomplete = SETUP_STEPS.findIndex((step) => !progress.data?.[step.progressKey]);

  return (
    <main className="verolane-wash relative min-h-screen overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 paper-grain opacity-20" />
      <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-leaf/10 blur-3xl" />

      <div className="relative mx-auto max-w-[1180px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <header className="flex items-center justify-between gap-4 border-b border-border/70 pb-5">
          <div className="flex items-center gap-3 lg:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-ink shadow-lg shadow-ink/10">
              <img src="/favicon.png" alt="" className="h-7 w-7" />
            </span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Verolane
              </p>
              <p className="font-serif text-xl leading-none text-ink">Chronos-V</p>
            </div>
          </div>
          <p className="hidden text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground lg:block">
            Getting started
          </p>
          <Button asChild variant="ghost" className="text-muted-foreground">
            <Link to="/today">Skip for now</Link>
          </Button>
        </header>

        <section className="grid gap-8 py-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] lg:items-center lg:py-16">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-ember/20 bg-card/80 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-ember shadow-sm">
              <Sparkles className="h-3.5 w-3.5" /> A calmer day starts here
            </div>
            <h1 className="mt-5 max-w-3xl font-serif text-4xl leading-[1.04] text-ink sm:text-5xl lg:text-6xl">
              Welcome to a schedule that <span className="text-ember italic">fits real life.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              Three small choices give Chronos-V enough context to build a useful plan. Everything
              is optional, reversible, and always under your control.
            </p>
          </div>

          <aside className="relative overflow-hidden rounded-3xl bg-ink p-6 text-paper shadow-[0_28px_70px_rgba(0,46,40,0.18)] sm:p-8">
            <div className="absolute -right-12 -top-12 h-44 w-44 rounded-full border border-paper/10" />
            <div className="absolute -right-4 top-4 h-28 w-28 rounded-full border border-paper/10" />
            <p className="relative text-[10px] font-semibold uppercase tracking-[0.2em] text-leaf">
              What happens next
            </p>
            <h2 className="relative mt-3 font-serif text-3xl leading-tight">
              A plan you can trust before the day begins.
            </h2>
            <ul className="relative mt-6 space-y-3">
              {OUTCOMES.map((outcome) => (
                <li key={outcome} className="flex items-start gap-3 text-sm text-paper/70">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-leaf/15 text-leaf">
                    <Check className="h-3 w-3" />
                  </span>
                  {outcome}
                </li>
              ))}
            </ul>
            <div className="relative mt-7 flex items-start gap-3 rounded-2xl border border-paper/10 bg-paper/5 p-4">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
              <p className="text-xs leading-5 text-paper/55">
                Connecting a source never happens automatically. Chronos-V shows what it needs and
                lets you disconnect it later.
              </p>
            </div>
          </aside>
        </section>

        <section aria-labelledby="setup-heading" className="pb-12 lg:pb-16">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ember">
                About three minutes
              </p>
              <h2 id="setup-heading" className="mt-1 font-serif text-3xl text-ink">
                Shape your first plan
              </h2>
            </div>
            <div className="min-w-44 sm:text-right">
              <p className="text-sm font-medium text-ink">
                {progress.isLoading
                  ? "Checking your setup…"
                  : progress.isError
                    ? "Progress unavailable"
                    : `${completed} of 3 ready`}
              </p>
              <div
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary"
                role="progressbar"
                aria-label="Setup progress"
                aria-valuemin={0}
                aria-valuemax={3}
                aria-valuenow={completed}
              >
                <div
                  className="h-full rounded-full bg-leaf transition-[width] duration-500"
                  style={{ width: `${(completed / 3) * 100}%` }}
                />
              </div>
            </div>
          </div>

          <ol className="grid gap-4 lg:grid-cols-3">
            {SETUP_STEPS.map((step, index) => {
              const Icon = step.icon;
              const isReady = progress.data?.[step.progressKey] ?? false;
              const isNext = !progress.isLoading && !progress.isError && index === firstIncomplete;
              return (
                <li
                  key={step.number}
                  className={`group flex min-h-[19rem] flex-col rounded-3xl border bg-card/90 p-5 shadow-[0_16px_45px_rgba(0,46,40,0.045)] transition-transform hover:-translate-y-1 sm:p-6 ${
                    isReady ? "border-leaf/35" : isNext ? "border-ember/40" : "border-border/80"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`grid h-11 w-11 place-items-center rounded-2xl transition-colors ${
                        isReady
                          ? "bg-leaf/15 text-ink"
                          : "bg-secondary text-ink group-hover:bg-ink group-hover:text-paper"
                      }`}
                    >
                      {isReady ? (
                        <CheckCircle2 className="h-5 w-5 text-leaf" />
                      ) : (
                        <Icon className="h-5 w-5" />
                      )}
                    </span>
                    {isReady ? (
                      <span className="rounded-full bg-leaf/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink">
                        Ready
                      </span>
                    ) : isNext ? (
                      <span className="rounded-full bg-ember/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-ember">
                        Next
                      </span>
                    ) : (
                      <span className="font-serif text-2xl text-border">{step.number}</span>
                    )}
                  </div>
                  <h3 className="mt-6 font-serif text-2xl leading-tight text-ink">{step.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{step.description}</p>
                  <p className="mt-3 text-xs leading-5 text-muted-foreground/80">
                    {isReady ? step.readyNote : step.note}
                  </p>
                  <Link
                    to={step.to}
                    className="mt-auto inline-flex items-center gap-2 pt-6 text-sm font-semibold text-ember outline-none transition-[gap] group-hover:gap-3 focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ember focus-visible:ring-offset-2"
                  >
                    {isReady ? step.reviewAction : step.action} <ArrowRight className="h-4 w-4" />
                  </Link>
                </li>
              );
            })}
          </ol>

          <div className="mt-6 flex flex-col items-center justify-between gap-4 rounded-3xl border border-border/80 bg-card/70 p-5 text-center sm:flex-row sm:p-6 sm:text-left">
            <div>
              <p className="font-serif text-xl text-ink">
                {allReady ? "Your foundation is ready." : "Ready to look around first?"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {allReady
                  ? "Chronos-V can now build around your real rhythm and priorities."
                  : "You can return to every setup option whenever you need it."}
              </p>
            </div>
            <Button asChild className="h-11 w-full rounded-xl px-5 sm:w-auto">
              <Link to="/today">
                Open today <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}
