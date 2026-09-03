import { Lock, Move } from "lucide-react";
import type { ScheduleEvent } from "@/lib/schedule-hub";

export function SourceBadge({ event, className = "" }: { event: ScheduleEvent; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground ${className}`}
    >
      {event.source_label}
    </span>
  );
}

export function CommitmentBadge({ event, className = "" }: { event: ScheduleEvent; className?: string }) {
  const fixed = event.commitment_type === "fixed";
  return (
    <span
      title={fixed ? "Fixed — Chronos-V will not move this" : "Flexible — Chronos-V can move this"}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${
        fixed ? "bg-secondary text-muted-foreground" : "bg-accent/15 text-accent"
      } ${className}`}
    >
      {fixed ? <Lock className="h-2.5 w-2.5" /> : <Move className="h-2.5 w-2.5" />}
      {fixed ? "Fixed" : "Flexible"}
    </span>
  );
}

export function AllDayBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground ${className}`}
    >
      All day
    </span>
  );
}
