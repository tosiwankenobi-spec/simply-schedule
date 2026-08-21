import { useState } from "react";
import { format } from "date-fns";
import { dailyBriefing, type Briefing } from "@/lib/tasks.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Sunrise, Sparkles } from "lucide-react";

export function DailyBriefing() {
  const [data, setData] = useState<Briefing | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await dailyBriefing({ data: { date: format(new Date(), "yyyy-MM-dd") } });
      setData(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't build your briefing");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 rounded-xl border border-border bg-card px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="inline-flex items-center gap-2 font-serif text-lg">
          <Sunrise className="h-4 w-4 text-accent" /> Daily briefing
        </h2>
        <Button size="sm" variant="outline" onClick={run} disabled={busy}>
          <Sparkles className="h-3.5 w-3.5 mr-1.5" /> {busy ? "Thinking…" : data ? "Refresh" : "Generate"}
        </Button>
      </div>

      {data ? (
        <div className="mt-3 space-y-2">
          <p className="font-serif text-base text-foreground">{data.headline}</p>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            {data.bullets.map((b, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-accent">·</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
          {data.focus && (
            <p className="mt-2 rounded-lg bg-accent/10 px-3 py-2 text-sm text-foreground">
              <span className="font-medium">Protect time for:</span> {data.focus}
            </p>
          )}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          A short read on today's schedule, gaps, and the one thing worth protecting.
        </p>
      )}
    </section>
  );
}
