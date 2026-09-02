import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowLeft,
  CalendarPlus,
  CircleAlert,
  Clock3,
  Inbox,
  Mail,
  MapPin,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  acceptGmailCandidate,
  dismissGmailCandidate,
  scanGmailInbox,
  type SmartInboxCandidate,
  type SmartInboxScanResult,
} from "@/lib/gmail.functions";

export const Route = createFileRoute("/_authenticated/inbox")({
  component: SmartInboxPage,
  head: () => ({
    meta: [
      { title: "Smart Inbox · Chronos-V" },
      {
        name: "description",
        content: "Review appointment suggestions from Gmail before adding them to your schedule.",
      },
    ],
  }),
});

function timeLabel(candidate: SmartInboxCandidate) {
  const start = new Date(candidate.starts_at);
  if (!candidate.ends_at) return format(start, "EEE, MMM d 'at' h:mm a");
  const end = new Date(candidate.ends_at);
  const endPattern =
    start.toDateString() === end.toDateString() ? "h:mm a" : "EEE, MMM d 'at' h:mm a";
  return `${format(start, "EEE, MMM d 'at' h:mm a")} – ${format(end, endPattern)}`;
}

function CandidateCard({
  candidate,
  busy,
  onAccept,
  onDismiss,
}: {
  candidate: SmartInboxCandidate;
  busy: boolean;
  onAccept: (candidate: SmartInboxCandidate) => void;
  onDismiss: (candidate: SmartInboxCandidate) => void;
}) {
  return (
    <Card className={candidate.conflicts > 0 ? "border-amber-500/50" : undefined}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="break-words">{candidate.title}</CardTitle>
            <CardDescription className="mt-1 break-words">
              {candidate.from || "Unknown sender"}
              {candidate.subject ? ` · ${candidate.subject}` : ""}
            </CardDescription>
          </div>
          <Badge variant={candidate.conflicts > 0 ? "destructive" : "secondary"}>
            {candidate.conflicts > 0
              ? `${candidate.conflicts} conflict${candidate.conflicts === 1 ? "" : "s"}`
              : "No conflict"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 text-sm">
          <p className="flex items-start gap-2">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span>{timeLabel(candidate)}</span>
          </p>
          {candidate.location ? (
            <p className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="break-words">{candidate.location}</span>
            </p>
          ) : null}
          {candidate.notes ? <p className="text-muted-foreground">{candidate.notes}</p> : null}
        </div>

        {candidate.conflicts > 0 ? (
          <div className="flex gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>This overlaps your schedule. Review the time before adding it anyway.</span>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => onAccept(candidate)}>
            <CalendarPlus className="mr-1.5 h-4 w-4" />
            {candidate.conflicts > 0 ? "Add anyway" : "Add to schedule"}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => onDismiss(candidate)}>
            <X className="mr-1.5 h-4 w-4" /> Dismiss
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ScanSummary({ result }: { result: SmartInboxScanResult }) {
  const handled = result.alreadyHandled + result.dismissed;
  return (
    <p className="text-sm text-muted-foreground">
      Scanned {result.scanned} recent matching email{result.scanned === 1 ? "" : "s"}. Found{" "}
      {result.candidates.length} suggestion{result.candidates.length === 1 ? "" : "s"}
      {handled > 0 ? `; ${handled} already handled` : ""}
      {result.skipped > 0 ? `; ${result.skipped} not clear enough to suggest` : ""}.
    </p>
  );
}

function SmartInboxPage() {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<SmartInboxScanResult | null>(null);

  const scan = useMutation({
    mutationFn: () => scanGmailInbox({ data: { tzOffsetMin: new Date().getTimezoneOffset() } }),
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["privacy-status"] });
      if (data.candidates.length > 0) {
        toast.success(
          `${data.candidates.length} suggestion${data.candidates.length === 1 ? "" : "s"} ready to review`,
        );
      } else {
        toast.message("No new appointment suggestions found");
      }
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Couldn't scan Gmail"),
  });

  const accept = useMutation({
    mutationFn: (candidate: SmartInboxCandidate) =>
      acceptGmailCandidate({
        data: {
          messageId: candidate.messageId,
          threadId: candidate.threadId,
          from: candidate.from,
          subject: candidate.subject,
          title: candidate.title,
          starts_at: candidate.starts_at,
          ends_at: candidate.ends_at,
          location: candidate.location,
          notes: candidate.notes,
        },
      }),
    onSuccess: (data, candidate) => {
      setResult((current) =>
        current
          ? {
              ...current,
              candidates: current.candidates.filter(
                (item) => item.messageId !== candidate.messageId,
              ),
            }
          : current,
      );
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      queryClient.invalidateQueries({ queryKey: ["privacy-status"] });
      toast.success(data.alreadyAdded ? "Already on your schedule" : "Added to your schedule", {
        description:
          data.conflicts > 0
            ? `Kept despite ${data.conflicts} overlapping appointment${data.conflicts === 1 ? "" : "s"}.`
            : undefined,
      });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Couldn't add that suggestion"),
  });

  const dismiss = useMutation({
    mutationFn: (candidate: SmartInboxCandidate) =>
      dismissGmailCandidate({ data: { messageId: candidate.messageId } }),
    onSuccess: (_data, candidate) => {
      setResult((current) =>
        current
          ? {
              ...current,
              candidates: current.candidates.filter(
                (item) => item.messageId !== candidate.messageId,
              ),
              dismissed: current.dismissed + 1,
            }
          : current,
      );
      toast.success("Suggestion dismissed");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Couldn't dismiss that suggestion"),
  });

  const busy = scan.isPending || accept.isPending || dismiss.isPending;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Button asChild variant="ghost" size="sm" className="mb-6 -ml-2 text-muted-foreground">
          <Link to="/app">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to schedule
          </Link>
        </Button>

        <div className="flex items-center gap-2 text-accent">
          <Inbox className="h-5 w-5" />
          <span className="text-sm font-medium">Smart Inbox</span>
        </div>
        <h1 className="mt-2 font-serif text-4xl text-foreground">Your inbox, with a checkpoint.</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Chronos-V looks for likely appointments in recent matching Gmail messages. Nothing is
          added until you approve it here.
        </p>

        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" /> Scan recent Gmail
            </CardTitle>
            <CardDescription>
              A scan reads up to 15 recent messages that match appointment terms. Raw message bodies
              are not stored.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={() => scan.mutate()} disabled={busy}>
              <RefreshCw className={`mr-1.5 h-4 w-4 ${scan.isPending ? "animate-spin" : ""}`} />
              {scan.isPending ? "Scanning…" : result ? "Scan again" : "Scan Gmail"}
            </Button>
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Gmail access follows your{" "}
                <Link to="/privacy" className="underline">
                  Privacy controls
                </Link>{" "}
                and uses your signed-in account's RLS-protected data path.
              </span>
            </p>
            {result ? <ScanSummary result={result} /> : null}
          </CardContent>
        </Card>

        {result ? (
          <div className="mt-6 space-y-4">
            {result.candidates.length > 0 ? (
              result.candidates.map((candidate) => (
                <CandidateCard
                  key={candidate.messageId}
                  candidate={candidate}
                  busy={busy}
                  onAccept={(item) => accept.mutate(item)}
                  onDismiss={(item) => dismiss.mutate(item)}
                />
              ))
            ) : (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center">
                  <Inbox className="mx-auto h-7 w-7 text-muted-foreground" />
                  <p className="mt-3 font-serif text-lg">You're all caught up.</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    No unreviewed appointment suggestions remain from this scan.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
