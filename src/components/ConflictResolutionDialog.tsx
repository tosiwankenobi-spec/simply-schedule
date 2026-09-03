import { format } from "date-fns";
import { AlertTriangle, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PlacementAssessment } from "@/lib/appointment-placement.functions";

export type ConflictProposal = {
  title: string;
  startsAt: string;
  endsAt: string | null;
  assessment: PlacementAssessment;
};

export function ConflictResolutionDialog({
  proposal,
  busy,
  onCancel,
  onChoose,
  onKeepAnyway,
}: {
  proposal: ConflictProposal | null;
  busy: boolean;
  onCancel: () => void;
  onChoose: (startsAt: string, endsAt: string) => void;
  onKeepAnyway: () => void;
}) {
  const assessment = proposal?.assessment;
  return (
    <Dialog open={Boolean(proposal)} onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-2xl">
            <AlertTriangle className="h-5 w-5 text-amber-600" /> This time is already busy
          </DialogTitle>
          <DialogDescription>
            {proposal?.title} overlaps {assessment?.conflicts.map((item) => item.title).join(", ")}.
            Choose the least disruptive opening, or keep the overlap intentionally.
          </DialogDescription>
        </DialogHeader>

        {assessment?.alternatives.length ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Closest openings inside {assessment.workHours.profile} hours (
              {assessment.workHours.start}–{assessment.workHours.end})
            </p>
            {assessment.alternatives.map((alternative) => (
              <Button
                key={alternative.startsAt}
                variant="outline"
                className="h-auto w-full justify-start px-4 py-3 text-left"
                disabled={busy}
                onClick={() => onChoose(alternative.startsAt, alternative.endsAt)}
              >
                <Clock3 className="mr-2 h-4 w-4 shrink-0 text-accent" />
                <span>
                  <span className="block font-medium">
                    {format(new Date(alternative.startsAt), "EEE, MMM d · h:mm a")} –{" "}
                    {format(new Date(alternative.endsAt), "h:mm a")}
                  </span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    {alternative.distanceMinutes} minutes {alternative.direction}
                  </span>
                </span>
              </Button>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
            No same-day opening fits inside your planner working hours.
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            Go back
          </Button>
          <Button variant="destructive" disabled={busy} onClick={onKeepAnyway}>
            {busy ? "Saving…" : "Keep overlap"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
