import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { CarFront, Clock3, MapPin, Pencil, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getNextTravelGuidance, updateAppointmentTravel } from "@/lib/travel.functions";
import { travelModeLabel } from "@/lib/travel-intelligence";

function statusCopy(status: "upcoming" | "prepare" | "leave_now" | "started") {
  if (status === "leave_now") return "Leave now";
  if (status === "prepare") return "Start getting ready";
  if (status === "started") return "Happening now";
  return "Travel plan";
}

export function TravelGuidanceCard() {
  const queryClient = useQueryClient();
  const guidance = useQuery({
    queryKey: ["next-travel-guidance"],
    queryFn: () => getNextTravelGuidance(),
    refetchInterval: 60000,
  });
  const [editing, setEditing] = useState(false);
  const [travelMinutes, setTravelMinutes] = useState("");
  const [preparationMinutes, setPreparationMinutes] = useState("");

  const save = useMutation({
    mutationFn: () => {
      const travel = travelMinutes.trim() ? Number(travelMinutes) : null;
      const preparation = preparationMinutes.trim() ? Number(preparationMinutes) : null;
      if (travel !== null && (!Number.isInteger(travel) || travel < 1 || travel > 720)) {
        throw new Error("Travel time must be between 1 and 720 minutes.");
      }
      if (
        preparation !== null &&
        (!Number.isInteger(preparation) || preparation < 0 || preparation > 240)
      ) {
        throw new Error("Preparation time must be between 0 and 240 minutes.");
      }
      if (!guidance.data) throw new Error("That appointment is no longer available.");
      return updateAppointmentTravel({
        data: {
          appointmentId: guidance.data.appointmentId,
          travelMinutes: travel,
          preparationMinutes: preparation,
        },
      });
    },
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["next-travel-guidance"] });
      queryClient.invalidateQueries({ queryKey: ["adaptive-reminder-preview"] });
      toast.success("Travel plan updated");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Couldn't update the travel plan"),
  });

  const data = guidance.data;
  if (!data) return null;

  const openEditor = () => {
    setTravelMinutes(data.travelOverride === null ? "" : String(data.travelOverride));
    setPreparationMinutes(
      data.preparationOverride === null ? "" : String(data.preparationOverride),
    );
    setEditing(true);
  };

  return (
    <section className="mt-4 rounded-2xl border border-sky-500/30 bg-card px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium text-sky-700 dark:text-sky-300">
            <CarFront className="h-4 w-4" /> {statusCopy(data.status)}
          </p>
          <h2 className="mt-1 truncate font-serif text-xl text-foreground">{data.title}</h2>
        </div>
        <Badge variant={data.status === "leave_now" ? "destructive" : "secondary"}>
          Leave by {format(new Date(data.leaveAt), "h:mm a")}
        </Badge>
      </div>

      <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
        <p className="flex items-start gap-2">
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Starts {format(new Date(data.startsAt), "EEE, MMM d 'at' h:mm a")}
            {data.preparationMinutes > 0
              ? ` · prepare at ${format(new Date(data.prepareAt), "h:mm a")}`
              : ""}
          </span>
        </p>
        <p className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="break-words">{data.location}</span>
        </p>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {travelModeLabel(data.mode)} · {data.travelMinutes} min travel + {data.bufferMinutes} min
        safety buffer
        {data.preparationMinutes > 0 ? ` + ${data.preparationMinutes} min to get ready` : ""}.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={openEditor}>
          <Pencil className="mr-1.5 h-3.5 w-3.5" /> Adjust this trip
        </Button>
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
          <Link to="/setup/notifications">Travel defaults</Link>
        </Button>
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />
        Times use your saved estimates. No location is sent to a mapping service.
      </p>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Adjust this trip</DialogTitle>
            <DialogDescription>
              Leave a field blank to use your default. This changes only {data.title}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="trip-minutes">Travel minutes</Label>
              <Input
                id="trip-minutes"
                type="number"
                min={1}
                max={720}
                placeholder={String(data.travelMinutes)}
                value={travelMinutes}
                onChange={(event) => setTravelMinutes(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prep-minutes">Get-ready minutes</Label>
              <Input
                id="prep-minutes"
                type="number"
                min={0}
                max={240}
                placeholder={String(data.preparationMinutes)}
                value={preparationMinutes}
                onChange={(event) => setPreparationMinutes(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save trip"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
