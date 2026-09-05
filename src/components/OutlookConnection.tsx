import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Loader2,
  PlugZap,
  RefreshCw,
  Trash2,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  completeOutlookConnect,
  deleteOutlookLocalCopies,
  disconnectOutlookAccount,
  getOutlookStatus,
  listOutlookCalendars,
  resetOutlookSyncState,
  selectOutlookCalendars,
  startOutlookConnect,
  syncOutlookNow,
} from "@/lib/outlook.functions";

const CONNECTOR_ID = "microsoft_outlook";

function waitForOAuthCompletion(popup: Window) {
  return new Promise<string | null>((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(poll);
    };
    const onMessage = (event: MessageEvent) => {
      const type = (event.data as { type?: string } | null)?.type;
      if (
        event.origin !== window.location.origin ||
        event.source !== popup ||
        (event.data as { connectorId?: string } | null)?.connectorId !== CONNECTOR_ID ||
        (type !== "appUserConnectorOAuthComplete" && type !== "appUserConnectorOAuthFailed")
      )
        return;
      cleanup();
      if (type === "appUserConnectorOAuthComplete") {
        const code = (event.data as { code?: string }).code;
        resolve(typeof code === "string" ? code : null);
        return;
      }
      popup.close();
      reject(new Error("The Microsoft connection was not completed."));
    };
    window.addEventListener("message", onMessage);
    const poll = window.setInterval(() => {
      if (!popup.closed) return;
      cleanup();
      reject(new Error("The Microsoft window closed before finishing."));
    }, 500);
  });
}

function relative(iso: string | null) {
  if (!iso) return "never";
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return "never";
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

export function OutlookConnection() {
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const status = useQuery({
    queryKey: ["outlook", "status"],
    queryFn: () => getOutlookStatus(),
    refetchOnWindowFocus: true,
  });

  const calendars = useQuery({
    queryKey: ["outlook", "calendars"],
    queryFn: () => listOutlookCalendars(),
    enabled: Boolean(status.data?.connected),
    retry: false,
  });

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["outlook"] });
    void qc.invalidateQueries({ queryKey: ["appointments"] });
    void qc.invalidateQueries({ queryKey: ["schedule-hub"] });
  }, [qc]);

  const connect = useMutation({
    mutationFn: async () => {
      const popup = window.open("", "chronos-outlook-oauth", "width=600,height=760");
      if (!popup) throw new Error("Allow pop-ups for Chronos-V, then try again.");
      let code: string | null;
      try {
        const { authorizationUrl } = await startOutlookConnect();
        const completion = waitForOAuthCompletion(popup);
        popup.location.href = authorizationUrl;
        code = await completion;
      } catch (error) {
        popup.close();
        throw error;
      }
      if (code) await completeOutlookConnect({ data: { code } });
    },
    onSuccess: () => {
      toast.success("Outlook connected");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sync = useMutation({
    mutationFn: () => syncOutlookNow(),
    onSuccess: (r) => {
      toast.success(
        `Outlook synced — ${r.updatedLocal} updated, ${r.removedLocal} removed, ${r.pushedNew + r.pushedUpdates} sent.`,
      );
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reconnect = useMutation({
    mutationFn: () => resetOutlookSyncState(),
    onSuccess: () => {
      toast.success("Outlook re-synced from scratch");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const disconnect = useMutation({
    mutationFn: () => disconnectOutlookAccount(),
    onSuccess: () => {
      toast.success("Outlook disconnected. Your saved events were kept.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeCopies = useMutation({
    mutationFn: () => deleteOutlookLocalCopies({ data: { confirm: "DELETE" } }),
    onSuccess: (r) => {
      toast.success(`${r.removed} Outlook events removed from Chronos-V.`);
      setConfirmDelete(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleCalendar = useMutation({
    mutationFn: (ids: string[]) => selectOutlookCalendars({ data: { calendarIds: ids } }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  const s = status.data;
  const busy = connect.isPending || sync.isPending || reconnect.isPending;

  return (
    <Card className="mt-6 border-border/70 bg-card/90">
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="font-serif text-xl">Your Outlook connection</CardTitle>
          {status.isLoading ? null : s?.connected ? (
            <Badge className="bg-leaf/20 text-ink hover:bg-leaf/20">
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden /> Connected
            </Badge>
          ) : (
            <Badge variant="outline">Not connected</Badge>
          )}
          {s?.needsReauth ? (
            <Badge variant="destructive">
              <AlertTriangle className="mr-1 h-3.5 w-3.5" aria-hidden /> Needs reconnect
            </Badge>
          ) : null}
        </div>
        <CardDescription>
          {s?.connected
            ? `${s.accountLabel ?? "Microsoft account"} · last sync ${relative(s.lastSyncedAt)} · ${s.localEventCount} events in Chronos-V`
            : "Sign in with your own Microsoft account. Chronos-V never sees your Microsoft password or tokens."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {status.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : !s?.connected ? (
          <Button
            className="min-h-11 w-full sm:w-auto"
            onClick={() => connect.mutate()}
            disabled={connect.isPending}
          >
            {connect.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <PlugZap className="mr-1.5 h-4 w-4" aria-hidden />
            )}
            Connect Outlook
          </Button>
        ) : (
          <>
            {s.lastError ? (
              <p
                role="alert"
                className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                {s.lastError}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button className="min-h-11" onClick={() => sync.mutate()} disabled={busy}>
                {sync.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden />
                )}
                Sync now
              </Button>
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => reconnect.mutate()}
                disabled={busy}
              >
                <CalendarClock className="mr-1.5 h-4 w-4" aria-hidden /> Full re-sync
              </Button>
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => connect.mutate()}
                disabled={busy}
              >
                <PlugZap className="mr-1.5 h-4 w-4" aria-hidden /> Reconnect account
              </Button>
              <Button
                variant="ghost"
                className="min-h-11"
                onClick={() => disconnect.mutate()}
                disabled={disconnect.isPending}
              >
                <Unplug className="mr-1.5 h-4 w-4" aria-hidden /> Disconnect
              </Button>
            </div>

            <section aria-labelledby="outlook-calendars-heading" className="space-y-2">
              <h3
                id="outlook-calendars-heading"
                className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
              >
                Calendars to sync
              </h3>
              {calendars.isLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : calendars.data?.length ? (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {calendars.data.map((cal) => {
                    const selectedIds = (calendars.data ?? [])
                      .filter((c) => c.selected)
                      .map((c) => c.id);
                    return (
                      <li
                        key={cal.id}
                        className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/60 px-3 py-2"
                      >
                        <Checkbox
                          id={`outlook-cal-${cal.id}`}
                          checked={cal.selected}
                          onCheckedChange={(checked) => {
                            const next = checked
                              ? Array.from(new Set([...selectedIds, cal.id]))
                              : selectedIds.filter((id) => id !== cal.id);
                            toggleCalendar.mutate(next);
                          }}
                        />
                        <label
                          htmlFor={`outlook-cal-${cal.id}`}
                          className="flex-1 cursor-pointer text-sm"
                        >
                          {cal.name}
                          {cal.isDefault ? (
                            <span className="ml-1.5 text-xs text-muted-foreground">(default)</span>
                          ) : null}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No calendars found yet. Use Sync now to look again.
                </p>
              )}
            </section>
          </>
        )}

        <section
          aria-labelledby="outlook-danger-heading"
          className="border-t border-border/60 pt-4"
        >
          <h3
            id="outlook-danger-heading"
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
          >
            Remove imported events
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Disconnecting keeps your saved copies. This removes every Outlook event from Chronos-V
            only — your Outlook calendar is untouched.
          </p>
          {confirmDelete ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="destructive"
                className="min-h-11"
                onClick={() => removeCopies.mutate()}
                disabled={removeCopies.isPending}
              >
                <Trash2 className="mr-1.5 h-4 w-4" aria-hidden /> Yes, remove them
              </Button>
              <Button variant="ghost" className="min-h-11" onClick={() => setConfirmDelete(false)}>
                Keep them
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              className="mt-2 min-h-11"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="mr-1.5 h-4 w-4" aria-hidden /> Remove Outlook copies…
            </Button>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
