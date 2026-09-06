import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  markNotificationsSeen,
  performNotificationAction,
  sweepNotifications,
  type SweepResult,
} from "@/lib/notifications.functions";
import {
  actionsForNotification,
  navigationUrl,
  type ActionableNotification,
  type NotificationAction,
} from "@/lib/notification-actions";
import {
  getDeviceNotificationPermission,
  initializeNotificationDelivery,
  requestDeviceNotificationPermission,
  showActionableDeviceNotification,
  type DevicePermission,
} from "@/lib/mobile-notifications";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Bell, BellRing, Loader2, Settings2 } from "lucide-react";
import { toast } from "sonner";

const POLL_MS = 60_000;

/** Bell + reminder sweep. Mounted once per authenticated screen. */
export function NotificationBell() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [unseen, setUnseen] = useState<SweepResult["unseen"]>([]);
  const [open, setOpen] = useState(false);
  const [permission, setPermission] = useState<DevicePermission>("unsupported");
  const [actingId, setActingId] = useState<string | null>(null);
  const running = useRef(false);

  useEffect(() => {
    void initializeNotificationDelivery();
    void getDeviceNotificationPermission().then(setPermission);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (running.current || document.hidden) return;
      running.current = true;
      try {
        const result = await sweepNotifications({
          data: {
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            localMinutes: new Date().getHours() * 60 + new Date().getMinutes(),
          },
        });
        if (cancelled) return;
        setUnseen(result.unseen);
        const delivery = await Promise.all(
          result.fresh.map(async (notification) => ({
            notification,
            shown: await showActionableDeviceNotification(notification).catch(() => false),
          })),
        );
        for (const item of delivery) {
          if (!item.shown) toast(item.notification.title, { description: item.notification.body });
        }
        if (result.emailError) console.warn("Reminder email:", result.emailError);
      } catch (error) {
        console.warn("Reminder sweep failed", error);
      } finally {
        running.current = false;
      }
    };

    void run();
    const timer = window.setInterval(run, POLL_MS);
    window.addEventListener("focus", run);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", run);
    };
  }, []);

  const askPermission = async () => {
    const next = await requestDeviceNotificationPermission();
    setPermission(next);
    if (next === "granted") toast.success("Device notifications enabled.");
  };

  const clearAll = async () => {
    await markNotificationsSeen({ data: {} });
    setUnseen([]);
  };

  const act = async (notification: ActionableNotification, action: NotificationAction) => {
    setActingId(notification.id);
    try {
      const result = await performNotificationAction({
        data: { notificationId: notification.id, action, snoozeMinutes: 15 },
      });
      setUnseen((current) => current.filter((item) => item.id !== notification.id));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["appointments"] }),
        queryClient.invalidateQueries({ queryKey: ["day-replan-preview"] }),
      ]);

      if (action === "open_navigation" && result.location) {
        window.location.assign(navigationUrl(result.location));
        return;
      }
      if (action === "reschedule" || action === "review_plan") {
        setOpen(false);
        await navigate({ to: "/planner" });
        return;
      }
      if (action === "open") {
        setOpen(false);
        await navigate({ to: result.targetType === "task" ? "/tasks" : "/today" });
        return;
      }
      toast.success(action === "done" ? "Task completed." : "Reminder snoozed for 15 minutes.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That reminder action failed.");
    } finally {
      setActingId(null);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className="relative" aria-label="Reminders">
          {unseen.length > 0 ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
          {unseen.length > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-medium text-accent-foreground">
              {unseen.length}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-1rem))] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="font-serif text-sm">Reminders</p>
          <Link
            to="/setup/notifications"
            onClick={() => setOpen(false)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Settings2 className="h-3.5 w-3.5" /> Settings
          </Link>
        </div>

        {permission === "default" ? (
          <button
            type="button"
            onClick={() => void askPermission()}
            className="w-full border-b border-border bg-muted/40 px-4 py-2.5 text-left text-xs text-muted-foreground hover:bg-muted"
          >
            Turn on actionable device reminders.
          </button>
        ) : null}
        {permission === "denied" ? (
          <p className="border-b border-border bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
            Device notifications are blocked in system settings. Reminders still appear here.
          </p>
        ) : null}

        {unseen.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing pending.</p>
        ) : (
          <ul className="max-h-[28rem] divide-y divide-border overflow-y-auto">
            {unseen.map((notification) => (
              <li key={notification.id} className="px-4 py-3">
                <p className="text-sm font-medium">{notification.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{notification.body}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {actionsForNotification(notification).map((action) => (
                    <Button
                      key={action.id}
                      type="button"
                      variant={action.id === "done" ? "default" : "outline"}
                      size="sm"
                      disabled={actingId === notification.id}
                      onClick={() => void act(notification, action.id)}
                      className="h-7 rounded-lg px-2.5 text-[11px]"
                    >
                      {actingId === notification.id && action.id === "done" ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : null}
                      {action.label}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}

        {unseen.length > 0 ? (
          <div className="border-t border-border p-2">
            <Button variant="ghost" size="sm" className="w-full" onClick={() => void clearAll()}>
              Mark all as read
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
