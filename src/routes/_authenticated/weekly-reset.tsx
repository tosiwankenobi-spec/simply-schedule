import { useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format, startOfWeek } from "date-fns";
import {
  applyWeeklyReset,
  previewWeeklyReset,
  type WeeklyResetPreview,
} from "@/lib/weekly-reset.functions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Clock3,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";

export const Route = createFileRoute("/_authenticated/weekly-reset")({
  component: WeeklyResetPage,
  head: () => ({
    meta: [
      { title: "Weekly Reset · Chronos-V" },
      {
        name: "description",
        content:
          "Review what happened, recover slipped work, and approve a realistic plan for next week.",
      },
    ],
  }),
});

function nextMonday() {
  return format(startOfWeek(addDays(new Date(), 7), { weekStartsOn: 1 }), "yyyy-MM-dd");
}

function WeeklyResetPage() {
  const [weekStart, setWeekStart] = useState(nextMonday);
  const tzOffsetMin = new Date().getTimezoneOffset();
  const preview = useQuery({
    queryKey: ["weekly-reset", weekStart, tzOffsetMin],
    queryFn: () => previewWeeklyReset({ data: { weekStart, tzOffsetMin } }),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(weekStart),
  });

  return (
    <main className="verolane-wash relative min-h-screen bg-background">
      <div className="pointer-events-none absolute inset-0 paper-grain opacity-20" />
      <div className="relative mx-auto max-w-[1180px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <WorkspaceHeader
          eyebrow="Weekly reset"
          title={
            <>
              Close the loop. <span className="text-accent italic">Start clear.</span>
            </>
          }
          description="See what moved, recover what slipped, and approve a realistic week without disturbing fixed commitments."
          action={
            <div className="space-y-1.5 rounded-xl border border-border bg-card/80 p-3">
              <Label htmlFor="week-start" className="text-xs">
                Week starting
              </Label>
              <Input
                id="week-start"
                type="date"
                value={weekStart}
                onChange={(event) => setWeekStart(event.target.value)}
                className="w-44 bg-background"
              />
            </div>
          }
        />

        {preview.isLoading ? (
          <div className="mt-8 flex items-center gap-2 rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" /> Building your reset…
          </div>
        ) : null}
        {preview.isError ? (
          <div className="mt-8 rounded-xl border border-destructive/30 bg-card p-5">
            <p className="text-sm text-destructive">Chronos-V couldn't build this reset.</p>
            <Button className="mt-3" variant="outline" onClick={() => preview.refetch()}>
              Try again
            </Button>
          </div>
        ) : null}
        {preview.data ? (
          <ResetReview
            key={`${preview.data.weekStart}:${preview.data.proposals
              .map((proposal) => `${proposal.task_id}:${proposal.task_updated_at}`)
              .join(",")}`}
            preview={preview.data}
          />
        ) : null}

        <div className="mt-6 flex items-start gap-2 rounded-2xl border border-border/70 bg-card/60 p-4 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          Weekly Reset uses only your own tasks, appointments, and planner preferences. Planning is
          deterministic and no schedule details are sent to an AI service.
        </div>
      </div>
    </main>
  );
}

function ResetReview({ preview }: { preview: WeeklyResetPreview }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(
    () => new Set(preview.proposals.map((item) => item.task_id)),
  );
  const apply = useMutation({
    mutationFn: () =>
      applyWeeklyReset({
        data: {
          weekStart: preview.weekStart,
          tzOffsetMin: new Date().getTimezoneOffset(),
          items: preview.proposals
            .filter((item) => selected.has(item.task_id))
            .map(({ task_id, starts_at, ends_at, task_updated_at }) => ({
              task_id,
              starts_at,
              ends_at,
              task_updated_at,
            })),
        },
      }),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["appointments"] }),
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["weekly-reset"] }),
        queryClient.invalidateQueries({ queryKey: ["day-replan-preview"] }),
      ]);
      if (result.added.length > 0) {
        toast.success(
          `${result.added.length} task block${result.added.length === 1 ? "" : "s"} added.`,
        );
      }
      if (result.skipped.length > 0) {
        toast.warning(
          `${result.skipped.length} item${result.skipped.length === 1 ? " was" : "s were"} skipped after rechecking.`,
        );
      }
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Couldn't apply this reset."),
  });

  const toggle = (taskId: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
  };

  return (
    <div className="mt-8 space-y-6">
      <section className="grid gap-4 md:grid-cols-2">
        <ReviewCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          title={`Completed (${preview.completed.length})`}
          empty="No tasks were marked complete in this review window."
          items={preview.completed.map((item) => ({ title: item.title, detail: item.detail }))}
        />
        <ReviewCard
          icon={<CircleAlert className="h-4 w-4" />}
          title={`Slipped (${preview.slipped.length})`}
          empty="Nothing overdue or left behind."
          items={preview.slipped.map((item) => ({ title: item.title, detail: item.detail }))}
        />
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-muted p-2">
            <CalendarDays className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-serif text-xl">What the week already holds</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {format(new Date(`${preview.weekStart}T12:00:00`), "MMM d")}–
              {format(addDays(new Date(`${preview.weekStart}T12:00:00`), 6), "MMM d")}
            </p>
          </div>
        </div>
        {preview.commitments.length > 0 ? (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {preview.commitments.map((appointment) => (
              <li
                key={appointment.id}
                className="rounded-lg border border-border bg-background p-3"
              >
                <p className="text-sm font-medium">{appointment.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {format(new Date(appointment.starts_at), "EEE · h:mm a")}
                  {appointment.location ? ` · ${appointment.location}` : ""}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            No fixed commitments are on the calendar yet.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-accent/30 bg-card p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-accent/10 p-2 text-accent">
            <CalendarCheck className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-serif text-xl">Proposed flexible blocks</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Up to three priority tasks per day, inside working hours with appointments and lunch
              protected.
            </p>
          </div>
        </div>

        {preview.proposals.length > 0 ? (
          <ul className="mt-4 divide-y divide-border rounded-xl border border-border bg-background">
            {preview.proposals.map((proposal) => (
              <li key={proposal.task_id} className="flex items-start gap-3 p-3.5">
                <Checkbox
                  checked={selected.has(proposal.task_id)}
                  onCheckedChange={(checked) => toggle(proposal.task_id, checked === true)}
                  aria-label={`Include ${proposal.title}`}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{proposal.title}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Clock3 className="h-3 w-3" />
                      {format(new Date(proposal.starts_at), "EEE, MMM d · h:mm a")}–
                      {format(new Date(proposal.ends_at), "h:mm a")}
                    </span>
                    <span>{proposal.estimated_min} min</span>
                    {proposal.deadline ? <span>Due {proposal.deadline}</span> : null}
                  </p>
                  {proposal.reason ? (
                    <p className="mt-1.5 text-xs text-muted-foreground">{proposal.reason}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-lg bg-muted/40 p-4 text-sm text-muted-foreground">
            There are no open or recoverable tasks to place this week.
          </p>
        )}

        {preview.unplaced.length > 0 ? (
          <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            Still unscheduled:{" "}
            {preview.unplaced.map((task) => `${task.title} (${task.estimated_min}m)`).join(", ")}.
          </div>
        ) : null}

        <Button
          className="mt-4 w-full bg-foreground text-background hover:bg-foreground/90"
          disabled={selected.size === 0 || apply.isPending}
          onClick={() => apply.mutate()}
        >
          <CalendarCheck className="mr-1.5 h-4 w-4" />
          {apply.isPending
            ? "Rechecking and adding…"
            : `Approve ${selected.size} block${selected.size === 1 ? "" : "s"}`}
        </Button>
      </section>
    </div>
  );
}

function ReviewCard({
  icon,
  title,
  empty,
  items,
}: {
  icon: ReactNode;
  title: string;
  empty: string;
  items: { title: string; detail: string }[];
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="flex items-center gap-2 font-serif text-lg">
        {icon} {title}
      </h2>
      {items.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {items.slice(0, 8).map((item) => (
            <li key={`${item.title}:${item.detail}`} className="rounded-lg bg-muted/40 px-3 py-2">
              <p className="text-sm">{item.title}</p>
              <p className="text-xs text-muted-foreground">{item.detail}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}
