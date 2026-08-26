import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  sweepNotifications,
  markNotificationsSeen,
  type SweepResult,
} from "@/lib/notifications.functions";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Bell, BellRing, Settings2 } from "lucide-react";
import { toast } from "sonner";

const POLL_MS = 60_000;

function showDeviceNotification(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission !== "granted") return false;
  try {
    new Notification(title, { body, icon: "/icons/icon-192.png", tag: title });
    return true;
  } catch {
    return false;
  }
}

/** Bell + background reminder sweep. Mounted once per authenticated screen. */
export function NotificationBell() {
  const qc = useQueryClient();
  const [unseen, setUnseen] = useState<SweepResult["unseen"]>([]);
  const [open, setOpen] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported",
  );
  const running = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (running.current || document.hidden) return;
      running.current = true;
      try {
        const res = await sweepNotifications({
          data: {
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            localMinutes: new Date().getHours() * 60 + new Date().getMinutes(),
          },
        });
        if (cancelled) return;
        setUnseen(res.unseen);
        for (const n of res.fresh) {
          if (!showDeviceNotification(n.title, n.body)) {
            toast(n.title, { description: n.body });
          }
        }
        if (res.emailError) console.warn("Reminder email:", res.emailError);
      } catch (e) {
        console.warn("Reminder sweep failed", e);
      } finally {
        running.current = false;
      }
    };

    run();
    const timer = window.setInterval(run, POLL_MS);
    window.addEventListener("focus", run);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", run);
    };
  }, []);

  const askPermission = async () => {
    if (!("Notification" in window)) return;
    const p = await Notification.requestPermission();
    setPermission(p);
    if (p === "granted") toast.success("Device notifications enabled.");
  };

  const clearAll = async () => {
    await markNotificationsSeen({ data: {} });
    setUnseen([]);
    qc.invalidateQueries({ queryKey: ["tasks"] });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className="relative" aria-label="Reminders">
          {unseen.length > 0 ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
          {unseen.length > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-medium text-accent-foreground">
              {unseen.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
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

        {permission === "default" && (
          <button
            onClick={askPermission}
            className="w-full border-b border-border bg-muted/40 px-4 py-2.5 text-left text-xs text-muted-foreground hover:bg-muted"
          >
            Turn on device notifications so reminders reach you outside the app.
          </button>
        )}
        {permission === "denied" && (
          <p className="border-b border-border bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
            Device notifications are blocked in your browser settings — reminders show here instead.
          </p>
        )}

        {unseen.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing pending.</p>
        ) : (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto">
            {unseen.map((n) => (
              <li key={n.id} className="px-4 py-3">
                <p className="text-sm">{n.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>
              </li>
            ))}
          </ul>
        )}

        {unseen.length > 0 && (
          <div className="border-t border-border p-2">
            <Button variant="ghost" size="sm" className="w-full" onClick={clearAll}>
              Mark all as read
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
