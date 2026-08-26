import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { downloadIcs } from "@/lib/ics";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CalendarArrowDown } from "lucide-react";
import { toast } from "sonner";

type Range = "today" | "week" | "month" | "all";

const RANGE_LABEL: Record<Range, string> = {
  today: "Today",
  week: "Next 7 days",
  month: "Next 30 days",
  all: "Everything",
};

function windowFor(range: Range) {
  const start = new Date();
  if (range !== "all") start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  if (range === "today") end.setDate(end.getDate() + 1);
  else if (range === "week") end.setDate(end.getDate() + 7);
  else if (range === "month") end.setDate(end.getDate() + 30);
  else end.setFullYear(end.getFullYear() + 5);
  return { start, end };
}

/** Exports the plan as a standards-compliant .ics file for any other calendar app. */
export function ExportIcsButton() {
  const [busy, setBusy] = useState(false);

  const run = async (range: Range) => {
    setBusy(true);
    try {
      const { start, end } = windowFor(range);
      let q = supabase
        .from("appointments")
        .select("id,title,starts_at,ends_at,location,notes")
        .gte("starts_at", start.toISOString())
        .order("starts_at");
      if (range !== "all") q = q.lt("starts_at", end.toISOString());
      const { data, error } = await q;
      if (error) throw error;
      if (!data || data.length === 0) {
        toast("Nothing to export in that range.");
        return;
      }
      downloadIcs(
        data as any,
        `chronos-v-${range}-${new Date().toISOString().slice(0, 10)}.ics`,
        `Chronos-V · ${RANGE_LABEL[range]}`,
      );
      toast.success(`Exported ${data.length} event${data.length === 1 ? "" : "s"}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={busy}>
          <CalendarArrowDown className="h-4 w-4 mr-1.5" /> {busy ? "Exporting…" : "Export .ics"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Download as iCal</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
          <DropdownMenuItem key={r} onSelect={() => run(r)}>
            {RANGE_LABEL[r]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
