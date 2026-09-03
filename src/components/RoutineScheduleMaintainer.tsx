import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { maintainRoutineSchedule } from "@/lib/routines.functions";

export function RoutineScheduleMaintainer() {
  const queryClient = useQueryClient();
  const fromDate = format(new Date(), "yyyy-MM-dd");
  const maintenance = useQuery({
    queryKey: ["routine-maintenance", fromDate],
    queryFn: () => maintainRoutineSchedule({ data: { fromDate } }),
    staleTime: 12 * 60 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!maintenance.data || maintenance.data.materialized === 0) return;
    queryClient.invalidateQueries({ queryKey: ["appointments"] });
    queryClient.invalidateQueries({ queryKey: ["next-travel-guidance"] });
    queryClient.invalidateQueries({ queryKey: ["adaptive-reminder-preview"] });
  }, [maintenance.data, queryClient]);

  return null;
}
