import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSyncStatus, syncGoogleCalendar, reconnectCalendarSync } from "@/lib/calendar.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { AlertTriangle, PlugZap, RefreshCw, Settings } from "lucide-react";

const STALE_MINUTES = 60;

/**
 * In-app banner that surfaces expired Google authorization, sync failures,
 * or a sync that has gone stale — with one-click retry / reconnect.
 */
export function SyncAlert() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<"retry" | "reconnect" | null>(null);

  const { data: status } = useQuery({
    queryKey: ["sync-status"],
    queryFn: () => getSyncStatus(),
    refetchInterval: 5 * 60 * 1000,
  });

  if (!status) return null;

  const stale =
    status.settings.auto_sync_enabled &&
    status.minutesSinceSync !== null &&
    status.minutesSinceSync > STALE_MINUTES;

  const problem = status.needsReauth || Boolean(status.lastError) || stale;
  if (!problem) return null;

  const authProblem = status.needsReauth;

  async function run(kind: "retry" | "reconnect") {
    setBusy(kind);
    const t = toast.loading(kind === "reconnect" ? "Reconnecting Google…" : "Retrying sync…");
    try {
      const res = kind === "reconnect" ? await reconnectCalendarSync() : await syncGoogleCalendar();
      toast.dismiss(t);
      qc.invalidateQueries({ queryKey: ["appointments"] });
      qc.invalidateQueries({ queryKey: ["day-replan-preview"] });
      qc.invalidateQueries({ queryKey: ["sync-status"] });
      if (res.errors[0]) {
        toast.warning("Still having trouble", { description: res.errors[0] });
      } else {
        toast.success("Google Calendar is back in sync");
      }
    } catch (err) {
      toast.dismiss(t);
      toast.error(err instanceof Error ? err.message : "Couldn't reach Google Calendar");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      role="alert"
      className={`mt-6 rounded-xl border px-4 py-3.5 ${
        authProblem ? "border-destructive/40 bg-destructive/5" : "border-accent/40 bg-accent/5"
      }`}
    >
      <div className="flex items-start gap-3">
        {authProblem ? (
          <PlugZap className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        ) : (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            {authProblem
              ? "Google access needs reconnecting"
              : stale && !status.lastError
                ? "Your calendar hasn't synced in a while"
                : "Last calendar sync ran into a problem"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground break-words">
            {status.lastError ??
              (authProblem
                ? "Your Google authorization expired or was revoked. Reconnect to resume two-way sync."
                : `Last successful sync ${status.minutesSinceSync ?? "—"} minutes ago.`)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => void run(authProblem ? "reconnect" : "retry")}
              disabled={busy !== null}
              className="bg-foreground text-background hover:bg-foreground/90"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${busy ? "animate-spin" : ""}`} />
              {authProblem ? "Reconnect & sync" : "Retry sync now"}
            </Button>
            {!authProblem && (
              <Button size="sm" variant="outline" onClick={() => void run("reconnect")} disabled={busy !== null}>
                <PlugZap className="h-3.5 w-3.5 mr-1.5" /> Full reconnect
              </Button>
            )}
            <Button asChild size="sm" variant="ghost" className="text-muted-foreground">
              <Link to="/setup/sync">
                <Settings className="h-3.5 w-3.5 mr-1" /> Sync settings
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
