import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  CalendarArrowUp,
  CalendarDays,
  CheckCircle2,
  Database,
  HardDrive,
  Mail,
  PauseCircle,
  ShieldCheck,
  Smartphone,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import {
  deleteProviderData,
  getPrivacyStatus,
  setProviderAccess,
  type PrivacyProvider,
  type PrivacyStatus,
} from "@/lib/privacy.functions";

export const Route = createFileRoute("/_authenticated/privacy")({
  component: PrivacyPage,
  head: () => ({
    meta: [
      { title: "Privacy controls · Chronos-V" },
      {
        name: "description",
        content:
          "See what Chronos-V can read, pause individual connections, and delete imported copies.",
      },
    ],
  }),
});

type ProviderCardProps = {
  provider: PrivacyProvider;
  title: string;
  icon: React.ReactNode;
  configured: boolean;
  enabled: boolean;
  importedItems: number;
  lastAccessedAt: string | null;
  reads: string;
  reason: string;
  stores: string;
  extra?: string;
  busy: boolean;
  onAccessChange: (provider: PrivacyProvider, enabled: boolean) => void;
  onDelete: (provider: PrivacyProvider) => void;
};

function statusLabel(configured: boolean, enabled: boolean) {
  if (!configured) return "Not connected";
  return enabled ? "Access active" : "Access paused";
}

function ProviderCard({
  provider,
  title,
  icon,
  configured,
  enabled,
  importedItems,
  lastAccessedAt,
  reads,
  reason,
  stores,
  extra,
  busy,
  onAccessChange,
  onDelete,
}: ProviderCardProps) {
  const deleteLabel = provider === "google_calendar" ? "calendar" : "Gmail";

  return (
    <Card className="rounded-2xl bg-card/90 shadow-[0_18px_45px_rgba(0,46,40,0.04)]">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-secondary p-2 text-foreground">{icon}</div>
            <div>
              <CardTitle>{title}</CardTitle>
              <CardDescription>
                {lastAccessedAt
                  ? `Last accessed ${format(new Date(lastAccessedAt), "MMM d, yyyy 'at' h:mm a")}`
                  : "No recorded access yet"}
              </CardDescription>
            </div>
          </div>
          <Badge variant={enabled ? "secondary" : "outline"}>
            {statusLabel(configured, enabled)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid gap-3 text-sm">
          <div>
            <dt className="font-medium text-foreground">What it can read</dt>
            <dd className="text-muted-foreground">{reads}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">Why Chronos-V uses it</dt>
            <dd className="text-muted-foreground">{reason}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">What is stored</dt>
            <dd className="text-muted-foreground">{stores}</dd>
          </div>
        </dl>

        <div className="rounded-lg border bg-secondary/30 px-4 py-3 text-sm">
          <p className="font-medium">
            {importedItems} imported item{importedItems === 1 ? "" : "s"}
          </p>
          {extra ? <p className="mt-1 text-muted-foreground">{extra}</p> : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant={enabled ? "outline" : "default"}
            disabled={!configured || busy}
            onClick={() => onAccessChange(provider, !enabled)}
          >
            {enabled ? (
              <PauseCircle className="mr-1.5 h-4 w-4" />
            ) : (
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
            )}
            {enabled ? "Pause access" : "Resume access"}
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                disabled={importedItems === 0 || busy}
                className="text-destructive"
              >
                <Trash2 className="mr-1.5 h-4 w-4" /> Delete imported copies
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Delete {importedItems} imported {deleteLabel} item{importedItems === 1 ? "" : "s"}
                  ?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This removes only Chronos-V's local copies. The original emails and Google
                  Calendar events will not be changed. Manually created appointments and tasks are
                  kept. Access will also be paused so the items are not imported again.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep copies</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => onDelete(provider)}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete local copies
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}

function DataInventory({ data }: { data: PrivacyStatus }) {
  return (
    <Card className="rounded-2xl bg-card/90 shadow-[0_18px_45px_rgba(0,46,40,0.04)]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" /> Your Chronos-V data
        </CardTitle>
        <CardDescription>
          Private application data protected by your signed-in Supabase account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border px-4 py-3">
            <p className="text-2xl font-semibold">{data.chronos.scheduleItems}</p>
            <p className="text-sm text-muted-foreground">schedule items</p>
          </div>
          <div className="rounded-lg border px-4 py-3">
            <p className="text-2xl font-semibold">{data.chronos.tasks}</p>
            <p className="text-sm text-muted-foreground">tasks</p>
          </div>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Normal app requests use your signed-in access token and Row Level Security. They do not
          use the server's service-role credential.
        </p>
      </CardContent>
    </Card>
  );
}

function PrivacyPage() {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["privacy-status"],
    queryFn: () => getPrivacyStatus(),
  });

  const access = useMutation({
    mutationFn: ({ provider, enabled }: { provider: PrivacyProvider; enabled: boolean }) =>
      setProviderAccess({ data: { provider, enabled } }),
    onSuccess: (data) => {
      queryClient.setQueryData(["privacy-status"], data);
      queryClient.invalidateQueries({ queryKey: ["sync-status"] });
      queryClient.invalidateQueries({ queryKey: ["google-calendars"] });
      toast.success("Privacy setting saved");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Couldn't save that setting"),
  });

  const remove = useMutation({
    mutationFn: (provider: PrivacyProvider) => deleteProviderData({ data: { provider } }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["privacy-status"] });
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      queryClient.invalidateQueries({ queryKey: ["day-replan-preview"] });
      queryClient.invalidateQueries({ queryKey: ["weekly-reset-preview"] });
      toast.success(`Deleted ${result.removed} imported item${result.removed === 1 ? "" : "s"}`);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Couldn't delete imported data"),
  });

  const data = status.data;
  const busy = access.isPending || remove.isPending;

  return (
    <div className="verolane-wash relative min-h-screen bg-background">
      <div className="pointer-events-none absolute inset-0 paper-grain opacity-20" />
      <div className="relative mx-auto max-w-[1180px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <WorkspaceHeader
          eyebrow="Privacy controls"
          title={
            <>
              Your data, connection by <span className="text-accent italic">connection.</span>
            </>
          }
          description="See what Chronos-V can access, pause it at any time, and delete imported copies without touching the originals in Google."
          action={
            <Button asChild variant="outline" className="bg-card/80">
              <Link to="/setup/sync">
                <CalendarDays className="mr-1.5 h-4 w-4" /> Connections
              </Link>
            </Button>
          }
        />

        {status.isLoading ? (
          <Card className="mt-8 rounded-2xl">
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              Loading privacy status…
            </CardContent>
          </Card>
        ) : status.isError || !data ? (
          <Card className="mt-8 rounded-2xl border-destructive/40">
            <CardContent className="py-8 text-sm text-destructive">
              {status.error instanceof Error
                ? status.error.message
                : "Couldn't load privacy status."}
            </CardContent>
          </Card>
        ) : (
          <div className="mt-8 space-y-6">
            <div className="grid gap-6 xl:grid-cols-2">
              <ProviderCard
                provider="google_calendar"
                title="Google Calendar"
                icon={<CalendarDays className="h-5 w-5" />}
                configured={data.calendar.configured}
                enabled={data.calendar.enabled}
                importedItems={data.calendar.importedItems}
                lastAccessedAt={data.calendar.lastAccessedAt}
                reads="Event titles, dates, times, locations, descriptions, and selected calendar identifiers."
                reason="To build the unified timeline, prevent conflicts, and protect fixed commitments while planning."
                stores="A local schedule copy, its Google event identifier, an incremental sync cursor, and a short sync activity log. Google OAuth tokens stay with Lovable's connection service."
                extra={`${data.calendar.selectedCalendars} calendar${data.calendar.selectedCalendars === 1 ? "" : "s"} selected · ${data.calendar.linkedItems} locally linked item${data.calendar.linkedItems === 1 ? "" : "s"}.`}
                busy={busy}
                onAccessChange={(provider, enabled) => access.mutate({ provider, enabled })}
                onDelete={(provider) => remove.mutate(provider)}
              />

              <ProviderCard
                provider="gmail"
                title="Gmail"
                icon={<Mail className="h-5 w-5" />}
                configured={data.gmail.configured}
                enabled={data.gmail.enabled}
                importedItems={data.gmail.importedItems}
                lastAccessedAt={data.gmail.lastAccessedAt}
                reads="Recent inbox messages that match appointment, delivery, school, renewal, or deadline terms, including sender, subject, date, and message text."
                reason="To suggest likely schedule items or tasks for your review. Nothing is added until you approve it. Matching message text is sent through Lovable's configured AI gateway during a scan; ambiguous messages are skipped."
                stores="Approved appointment or task details, message/thread identifiers needed for deduplication, dismissed message identifiers for 30 days, and a short sync activity log. Raw email bodies are not stored in Chronos-V."
                busy={busy}
                onAccessChange={(provider, enabled) => access.mutate({ provider, enabled })}
                onDelete={(provider) => remove.mutate(provider)}
              />
            </div>

            <div className="grid items-start gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
              <DataInventory data={data} />

              <Card className="rounded-2xl bg-ink text-paper shadow-[0_24px_55px_rgba(0,46,40,0.14)]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-paper">
                    <HardDrive className="h-5 w-5" /> Session and token storage
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-paper/65">
                  <p>
                    Supabase stores the signed-in session in browser storage on normal domains and
                    in the brokered Lovable preview store inside previews. Access tokens refresh
                    automatically and are never shown here.
                  </p>
                  <p>
                    Google provider credentials are not written into Chronos-V tables. Server-side
                    connector keys are never sent to the browser.
                  </p>
                  <p>
                    Travel guidance uses appointment locations and time estimates you control. It is
                    calculated inside Chronos-V and is not sent to a mapping provider.
                  </p>
                  <p>
                    Personal routines are private templates. Chronos-V expands them into upcoming
                    timeline entries inside your account so reminders and planning can use them.
                  </p>
                  <p>
                    Household items stay private unless you share them individually. Busy-only
                    sharing reveals the time but never the title, notes, or location; full details
                    is a separate, reversible choice.
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card className="rounded-2xl border-dashed bg-card/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Smartphone className="h-5 w-5" /> Other sources
                </CardTitle>
                <CardDescription>
                  Outlook and device calendars are never read automatically. You can preview and
                  import a local iCalendar snapshot now, or prepare a per-user Outlook connector
                  whose OAuth tokens stay in Lovable's encrypted gateway. Each imported snapshot can
                  be deleted independently.
                </CardDescription>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button asChild variant="outline">
                    <Link to="/calendar-import">
                      <CalendarArrowUp className="mr-1.5 h-4 w-4" /> Manage calendar imports
                    </Link>
                  </Button>
                  <Button asChild variant="ghost">
                    <Link to="/setup/outlook">Review Outlook setup</Link>
                  </Button>
                </div>
              </CardHeader>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
