import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  getSyncStatus,
  listGoogleCalendars,
  saveSyncSettings,
  syncGoogleCalendar,
  clearSyncLogEntries,
  resetCalendarSyncTokens,
  type ConflictPolicy,
} from "@/lib/calendar.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { RefreshCw, AlertTriangle, CheckCircle2, Info, Trash2, RotateCcw } from "lucide-react";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";

export const Route = createFileRoute("/_authenticated/setup/sync")({
  component: SyncSetupPage,
  head: () => ({
    meta: [
      { title: "Calendar sync settings · Chronos-V" },
      {
        name: "description",
        content:
          "Choose which Google Calendars sync, decide whether Google or your local edits win, and review sync status, tokens and recent errors.",
      },
      { property: "og:title", content: "Calendar sync settings · Chronos-V" },
      {
        property: "og:description",
        content: "Conflict rules, calendar selection and live sync diagnostics for Chronos-V.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const POLICIES: Array<{ value: ConflictPolicy; label: string; hint: string }> = [
  {
    value: "newest",
    label: "Newest change wins",
    hint: "Compare timestamps and keep whichever side was edited most recently. Recommended.",
  },
  {
    value: "remote",
    label: "Google Calendar wins",
    hint: "Google is authoritative. Local edits to synced events are overwritten and local deletions aren't pushed.",
  },
  {
    value: "local",
    label: "My local edits win",
    hint: "Chronos-V is authoritative. Your changes are pushed up and remote edits to the same event are ignored.",
  },
];

function SyncSetupPage() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const status = useQuery({ queryKey: ["sync-status"], queryFn: () => getSyncStatus() });
  const calendars = useQuery({
    queryKey: ["google-calendars"],
    queryFn: () => listGoogleCalendars(),
    retry: false,
  });

  const settings = status.data?.settings;

  const save = useMutation({
    mutationFn: (
      patch: Partial<{
        conflict_policy: ConflictPolicy;
        selected_calendar_ids: string[];
        auto_sync_enabled: boolean;
      }>,
    ) => saveSyncSettings({ data: patch }),

    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sync-status"] });
      qc.invalidateQueries({ queryKey: ["google-calendars"] });
      toast.success("Sync settings saved");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save settings"),
  });

  async function runSync() {
    setBusy(true);
    const t = toast.loading("Syncing with Google Calendar…");
    try {
      const res = await syncGoogleCalendar();
      toast.dismiss(t);
      qc.invalidateQueries({ queryKey: ["sync-status"] });
      qc.invalidateQueries({ queryKey: ["appointments"] });
      qc.invalidateQueries({ queryKey: ["day-replan-preview"] });
      if (res.errors.length > 0) {
        toast.warning("Sync finished with issues", { description: res.errors[0] });
      } else {
        toast.success(
          `In ${res.updatedLocal} · out ${res.pushedNew + res.pushedUpdates + res.pushedDeletes} · ${res.conflicts} conflict(s)`,
        );
      }
    } catch (e) {
      toast.dismiss(t);
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  }

  const selected = settings?.selected_calendar_ids ?? [];

  function toggleCalendar(id: string, on: boolean) {
    const next = on ? [...new Set([...selected, id])] : selected.filter((c) => c !== id);
    save.mutate({ selected_calendar_ids: next });
  }

  return (
    <div className="verolane-wash relative min-h-screen bg-background">
      <div className="pointer-events-none absolute inset-0 paper-grain opacity-20" />
      <div className="relative mx-auto max-w-[1180px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <WorkspaceHeader
          eyebrow="Calendar connections"
          title={
            <>
              Keep every calendar <span className="text-accent italic">in step.</span>
            </>
          }
          description="Control which Google Calendars flow into Chronos-V, decide who wins when both sides change, and see exactly what each sync run did."
          action={
            <Button onClick={runSync} disabled={busy}>
              <RefreshCw className={`mr-1.5 h-4 w-4 ${busy ? "animate-spin" : ""}`} />
              {busy ? "Syncing…" : "Sync now"}
            </Button>
          }
        />

        <div className="mt-8 grid items-start gap-6 xl:grid-cols-2">
          {/* Conflict resolution */}
          <Card className="rounded-2xl bg-card/90 shadow-[0_18px_45px_rgba(0,46,40,0.04)]">
            <CardHeader>
              <CardTitle>Conflict resolution</CardTitle>
              <CardDescription>
                Applies when the same event was changed in both Google Calendar and Chronos-V since
                the last sync.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <RadioGroup
                value={settings?.conflict_policy ?? "newest"}
                onValueChange={(v) => save.mutate({ conflict_policy: v as ConflictPolicy })}
                className="space-y-3"
              >
                {POLICIES.map((p) => (
                  <div key={p.value} className="flex items-start gap-3 rounded-xl border p-3">
                    <RadioGroupItem value={p.value} id={`policy-${p.value}`} className="mt-1" />
                    <div>
                      <Label htmlFor={`policy-${p.value}`} className="cursor-pointer font-medium">
                        {p.label}
                      </Label>
                      <p className="text-sm text-muted-foreground">{p.hint}</p>
                    </div>
                  </div>
                ))}
              </RadioGroup>

              <Separator />

              <div className="flex items-center justify-between">
                <div>
                  <Label className="font-medium">Automatic background sync</Label>
                  <p className="text-sm text-muted-foreground">
                    Sync every 5 minutes and whenever you return to the app.
                  </p>
                </div>
                <Switch
                  checked={settings?.auto_sync_enabled ?? true}
                  onCheckedChange={(v) => save.mutate({ auto_sync_enabled: v })}
                />
              </div>
            </CardContent>
          </Card>

          {/* Calendar selection */}
          <Card className="rounded-2xl bg-card/90 shadow-[0_18px_45px_rgba(0,46,40,0.04)]">
            <CardHeader>
              <CardTitle>Calendars to sync</CardTitle>
              <CardDescription>
                Only the calendars you tick are pulled in. New appointments you create here are
                written to your primary calendar.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {calendars.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading calendars…</p>
              ) : calendars.isError ? (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
                  <div>
                    <p className="font-medium">Couldn't load your calendar list</p>
                    <p className="text-muted-foreground">
                      {calendars.error instanceof Error ? calendars.error.message : "Unknown error"}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {(calendars.data ?? []).map((c) => {
                    const id = c.primary && selected.includes("primary") ? "primary" : c.id;
                    const checked =
                      selected.includes(c.id) || (c.primary && selected.includes("primary"));
                    return (
                      <label
                        key={c.id}
                        className="flex cursor-pointer items-center gap-3 rounded-xl border p-3 hover:bg-secondary/40"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => toggleCalendar(id, Boolean(v))}
                        />
                        <span
                          className="h-3 w-3 shrink-0 rounded-full border"
                          style={
                            c.backgroundColor ? { backgroundColor: c.backgroundColor } : undefined
                          }
                        />
                        <span className="flex-1 truncate text-sm">{c.summary}</span>
                        {c.primary && <Badge variant="secondary">Primary</Badge>}
                        {c.accessRole === "reader" && <Badge variant="outline">Read-only</Badge>}
                      </label>
                    );
                  })}
                  {selected.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No calendars selected — syncing is paused until you pick at least one.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Status panel */}
          <Card className="rounded-2xl bg-card/90 shadow-[0_18px_45px_rgba(0,46,40,0.04)] xl:col-span-2">
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle>Sync status</CardTitle>
                <CardDescription>
                  {status.data?.lastSyncedAt
                    ? `Last sync ${format(new Date(status.data.lastSyncedAt), "MMM d, h:mm:ss a")}`
                    : "Not synced yet"}
                </CardDescription>
              </div>
              <Badge variant={status.data?.lastSyncedAt ? "secondary" : "outline"}>
                {status.data?.lastSyncedAt ? "Connected" : "Awaiting first sync"}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                {(status.data?.calendars ?? []).map((c) => (
                  <div key={c.calendarId} className="rounded-lg border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium truncate">{c.calendarId}</span>
                      {c.hasSyncToken ? (
                        <Badge variant="secondary">Incremental</Badge>
                      ) : (
                        <Badge variant="outline">Full refresh next</Badge>
                      )}
                      {c.lastError && <Badge variant="destructive">Error</Badge>}
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      {c.eventsSeen} event{c.eventsSeen === 1 ? "" : "s"} over {c.pagesSynced} page
                      {c.pagesSynced === 1 ? "" : "s"}
                      {c.lastSyncedAt
                        ? ` · ${format(new Date(c.lastSyncedAt), "MMM d, h:mm a")}`
                        : ""}
                    </p>
                    {c.lastError && <p className="mt-1 text-destructive">{c.lastError}</p>}
                  </div>
                ))}
                {(status.data?.calendars ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground">No sync runs recorded yet.</p>
                )}
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Recent activity</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await resetCalendarSyncTokens();
                      qc.invalidateQueries({ queryKey: ["sync-status"] });
                      toast.success("Next sync will do a full refresh");
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reset tokens
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await clearSyncLogEntries();
                      qc.invalidateQueries({ queryKey: ["sync-status"] });
                      toast.success("Log cleared");
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Clear log
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                {(status.data?.log ?? []).map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    {entry.level === "error" ? (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    ) : entry.level === "warn" ? (
                      <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    ) : (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className={entry.level === "error" ? "text-destructive" : ""}>
                        {entry.message}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(entry.created_at), "MMM d, h:mm:ss a")} · {entry.kind}
                        {entry.calendar_id ? ` · ${entry.calendar_id}` : ""}
                      </p>
                    </div>
                  </div>
                ))}
                {(status.data?.log ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground">Nothing logged yet.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
