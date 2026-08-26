import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { listTasks } from "@/lib/tasks.functions";
import { Button } from "@/components/ui/button";
import { AlarmClock, Wand2 } from "lucide-react";

/** Persistent nudge that stays visible until every open task has a slot. */
export function TaskNudge() {
  const { data: tasks } = useQuery({ queryKey: ["tasks"], queryFn: () => listTasks() });

  const open = (tasks ?? []).filter((t) => t.status === "open");
  if (open.length === 0) return null;

  const now = Date.now();
  const ranked = [...open].sort((a, b) => {
    const ad = a.deadline ? Date.parse(a.deadline) : Number.POSITIVE_INFINITY;
    const bd = b.deadline ? Date.parse(b.deadline) : Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad - bd;
    return a.priority - b.priority;
  });
  const overdue = ranked.filter((t) => t.deadline && Date.parse(`${t.deadline}T23:59:59`) < now);
  const soon = ranked.filter(
    (t) =>
      t.deadline &&
      Date.parse(`${t.deadline}T23:59:59`) >= now &&
      Date.parse(`${t.deadline}T23:59:59`) - now < 48 * 3600 * 1000,
  );

  const urgent = overdue.length + soon.length;
  const tone = overdue.length > 0 ? "border-destructive/40 bg-destructive/5" : urgent > 0 ? "border-accent/50 bg-accent/5" : "border-border bg-card";

  return (
    <section className={`rounded-xl border p-4 ${tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-serif text-base">
            <AlarmClock className="h-4 w-4" />
            {open.length} task{open.length === 1 ? "" : "s"} still unscheduled
            {overdue.length > 0 && ` · ${overdue.length} overdue`}
          </p>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            Most urgent first: {ranked.slice(0, 3).map((t) => t.title).join(", ")}
            {ranked.length > 3 ? `, +${ranked.length - 3} more` : ""}
          </p>
        </div>
        <Button asChild size="sm" className="bg-accent text-accent-foreground hover:bg-accent/90">
          <Link to="/tasks">
            <Wand2 className="h-4 w-4 mr-1.5" /> Schedule them
          </Link>
        </Button>
      </div>
    </section>
  );
}
