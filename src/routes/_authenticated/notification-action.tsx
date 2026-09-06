import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { performNotificationAction } from "@/lib/notifications.functions";
import { navigationUrl } from "@/lib/notification-actions";
import { Button } from "@/components/ui/button";

const actionSchema = z.object({
  notificationId: z.string().uuid(),
  action: z.enum([
    "done",
    "snooze",
    "reschedule",
    "review_plan",
    "open_navigation",
    "open",
    "dismiss",
  ]),
});

export const Route = createFileRoute("/_authenticated/notification-action")({
  validateSearch: actionSchema,
  component: NotificationActionPage,
});

function NotificationActionPage() {
  const navigate = useNavigate();
  const { notificationId, action } = Route.useSearch();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void performNotificationAction({
      data: { notificationId, action, snoozeMinutes: 15 },
    })
      .then(async (result) => {
        if (action === "open_navigation" && result.location) {
          window.location.replace(navigationUrl(result.location));
          return;
        }
        if (action === "reschedule" || action === "review_plan") {
          await navigate({ to: "/planner", replace: true });
          return;
        }
        if (action === "open") {
          await navigate({
            to: result.targetType === "task" ? "/tasks" : "/today",
            replace: true,
          });
          return;
        }
        setComplete(true);
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "That reminder action failed.");
      });
  }, [action, navigate, notificationId]);

  return (
    <main className="grid min-h-[70vh] place-items-center px-4 py-10">
      <section className="w-full max-w-md rounded-3xl border border-border bg-card p-6 text-center shadow-[0_22px_55px_rgba(0,46,40,0.08)]">
        {error ? (
          <>
            <TriangleAlert className="mx-auto h-8 w-8 text-destructive" />
            <h1 className="mt-3 font-serif text-2xl">Action not completed</h1>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          </>
        ) : complete ? (
          <>
            <CheckCircle2 className="mx-auto h-8 w-8 text-accent" />
            <h1 className="mt-3 font-serif text-2xl">
              {action === "done"
                ? "Task completed"
                : action === "snooze"
                  ? "Reminder snoozed"
                  : "Reminder updated"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {action === "snooze"
                ? "Chronos-V will bring it back in 15 minutes."
                : action === "done"
                  ? "Your plan is up to date."
                  : "The reminder no longer needs your attention."}
            </p>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-accent" />
            <h1 className="mt-3 font-serif text-2xl">Updating your plan…</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Confirming this action against your private schedule.
            </p>
          </>
        )}
        {error || complete ? (
          <Button asChild className="mt-5">
            <Link to="/today">Return to Today</Link>
          </Button>
        ) : null}
      </section>
    </main>
  );
}
