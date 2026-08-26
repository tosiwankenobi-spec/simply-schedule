import { useState } from "react";
import { format } from "date-fns";
import type { AutoScheduleResult } from "@/lib/tasks.functions";
import { ChevronDown, Info } from "lucide-react";

/** Explains exactly which free gaps and rules produced a smart-scheduling preview. */
export function WhyTheseBlocks({ result }: { result: AutoScheduleResult }) {
  const [open, setOpen] = useState(false);
  const explain = result.explain;
  if (!explain) return null;

  const t = (iso: string) => format(new Date(iso), "h:mm a");
  const totalFree = explain.gaps.reduce((s, g) => s + g.minutes, 0);
  const used = explain.gaps.reduce((s, g) => s + g.used_min, 0);

  return (
    <div className="rounded-lg border border-border bg-muted/30">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5 text-muted-foreground" />
          Why these blocks?
        </span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {explain.gaps.length} free window{explain.gaps.length === 1 ? "" : "s"} · {used}/{totalFree}m used
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-border px-3 py-3 text-sm">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Free windows found</p>
            {explain.gaps.length === 0 ? (
              <p className="mt-1 text-muted-foreground">
                No free windows inside your working hours for this day.
              </p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {explain.gaps.map((g, i) => (
                  <li key={i} className="flex items-center justify-between gap-3">
                    <span>
                      Window {i + 1}: {t(g.start)} – {t(g.end)}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {g.minutes}m free · {g.used_min}m filled
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {result.placements.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Why each block landed there</p>
              <ul className="mt-1.5 space-y-1.5">
                {result.placements.map((p) => (
                  <li key={p.task_id}>
                    <span className="font-medium">{p.title}</span>{" "}
                    <span className="text-muted-foreground">
                      at {t(p.starts_at)} — {p.reason ?? "next available slot"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {explain.skipped.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Why some tasks were left out</p>
              <ul className="mt-1.5 space-y-1 text-muted-foreground">
                {explain.skipped.map((s) => (
                  <li key={s.id}>
                    <span className="text-foreground">{s.title}</span> — {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rules applied</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-4 text-muted-foreground">
              {explain.rules.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
