import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format } from "date-fns";
import {
  ArrowLeft,
  CalendarClock,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  deleteRoutine,
  listRoutines,
  saveRoutine,
  setRoutineActive,
  type RoutineRow,
} from "@/lib/routines.functions";
import {
  routineCadenceLabel,
  WEEKDAYS,
  type RoutineCategory,
  type RoutineCommitment,
  type RoutineFrequency,
} from "@/lib/routines";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/routines")({
  component: RoutinesPage,
  head: () => ({
    meta: [
      { title: "Personal routines · Chronos-V" },
      {
        name: "description",
        content:
          "Keep birthdays, annual commitments, medication, exercise, pickups, chores and bills in your timeline.",
      },
    ],
  }),
});

const CATEGORY_LABELS: Record<RoutineCategory, string> = {
  medication: "Medication",
  exercise: "Exercise",
  pickup: "Pickup",
  meal: "Meal prep",
  household: "Household",
  bill: "Bills",
  pet: "Pet care",
  birthday: "Birthday",
  other: "Other",
};

const MONTHS = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2024, index, 1)),
  ),
}));

function daysInAnnualMonth(month: number) {
  return new Date(Date.UTC(2024, month, 0)).getUTCDate();
}

type RoutineDraft = {
  title: string;
  category: RoutineCategory;
  frequency: RoutineFrequency;
  days_of_week: number[];
  annual_month: string;
  annual_day: string;
  local_time: string;
  duration_min: string;
  start_date: string;
  end_date: string;
  timezone: string;
  location: string;
  notes: string;
  commitment_type: RoutineCommitment;
  is_all_day: boolean;
  active: boolean;
};

function emptyDraft(): RoutineDraft {
  return {
    title: "",
    category: "other",
    frequency: "weekly",
    days_of_week: [1],
    annual_month: String(new Date().getMonth() + 1),
    annual_day: String(new Date().getDate()),
    local_time: "09:00",
    duration_min: "30",
    start_date: format(new Date(), "yyyy-MM-dd"),
    end_date: "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    location: "",
    notes: "",
    commitment_type: "fixed",
    is_all_day: false,
    active: true,
  };
}

function draftFromRoutine(routine: RoutineRow): RoutineDraft {
  return {
    title: routine.title,
    category: routine.category,
    frequency: routine.frequency,
    days_of_week: routine.days_of_week,
    annual_month: String(routine.annual_month ?? new Date().getMonth() + 1),
    annual_day: String(routine.annual_day ?? new Date().getDate()),
    local_time: routine.local_time.slice(0, 5),
    duration_min: String(routine.duration_min),
    start_date: routine.start_date,
    end_date: routine.end_date ?? "",
    timezone: routine.timezone,
    location: routine.location ?? "",
    notes: routine.notes ?? "",
    commitment_type: routine.commitment_type,
    is_all_day: routine.is_all_day,
    active: routine.active,
  };
}

function RoutinesPage() {
  const queryClient = useQueryClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const routines = useQuery({ queryKey: ["routines"], queryFn: () => listRoutines() });
  const [editing, setEditing] = useState<RoutineRow | null | undefined>(undefined);
  const [draft, setDraft] = useState<RoutineDraft>(emptyDraft);
  const [deleting, setDeleting] = useState<RoutineRow | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["routines"] });
    queryClient.invalidateQueries({ queryKey: ["appointments"] });
    queryClient.invalidateQueries({ queryKey: ["routine-maintenance"] });
    queryClient.invalidateQueries({ queryKey: ["adaptive-reminder-preview"] });
  };

  const save = useMutation({
    mutationFn: () =>
      saveRoutine({
        data: {
          id: editing?.id,
          title: draft.title,
          category: draft.category,
          frequency: draft.frequency,
          days_of_week:
            draft.frequency === "daily"
              ? [0, 1, 2, 3, 4, 5, 6]
              : draft.frequency === "weekly"
                ? draft.days_of_week
                : [],
          annual_month: draft.frequency === "yearly" ? Number(draft.annual_month) : null,
          annual_day: draft.frequency === "yearly" ? Number(draft.annual_day) : null,
          local_time: draft.local_time,
          duration_min: Number(draft.duration_min),
          start_date: draft.start_date,
          end_date: draft.end_date || null,
          timezone: draft.timezone,
          location: draft.location || null,
          notes: draft.notes || null,
          commitment_type: draft.commitment_type,
          is_all_day: draft.is_all_day,
          active: draft.active,
          fromDate: today,
        },
      }),
    onSuccess: (result) => {
      setEditing(undefined);
      invalidate();
      toast.success(
        `${editing ? "Routine updated" : "Routine created"} · ${result.materialized} upcoming times added`,
      );
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Couldn't save that routine"),
  });

  const toggle = useMutation({
    mutationFn: (routine: RoutineRow) =>
      setRoutineActive({ data: { id: routine.id, active: !routine.active, fromDate: today } }),
    onSuccess: (result) => {
      invalidate();
      toast.success(result.active ? "Routine resumed" : "Routine paused");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Couldn't update that routine"),
  });

  const remove = useMutation({
    mutationFn: (routine: RoutineRow) =>
      deleteRoutine({ data: { id: routine.id, fromDate: today } }),
    onSuccess: () => {
      setDeleting(null);
      invalidate();
      toast.success("Routine removed; past entries were kept");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Couldn't remove that routine"),
  });

  const openNew = () => {
    setDraft(emptyDraft());
    setEditing(null);
  };

  const openEdit = (routine: RoutineRow) => {
    setDraft(draftFromRoutine(routine));
    setEditing(routine);
  };

  const submit = () => {
    if (!draft.title.trim()) return toast.error("Give this routine a name.");
    if (draft.frequency === "weekly" && draft.days_of_week.length === 0) {
      return toast.error("Choose at least one day.");
    }
    if (draft.frequency === "yearly") {
      const month = Number(draft.annual_month);
      const day = Number(draft.annual_day);
      if (!month || !day || day > daysInAnnualMonth(month)) {
        return toast.error("Choose a valid month and day.");
      }
    }
    if (!draft.start_date || (!draft.is_all_day && !draft.local_time)) {
      return toast.error("Choose a start date and time.");
    }
    const duration = Number(draft.duration_min);
    if (!Number.isInteger(duration) || duration < 5 || duration > 480) {
      return toast.error("Duration must be between 5 and 480 minutes.");
    }
    save.mutate();
  };

  return (
    <div className="relative min-h-screen bg-background">
      <div className="absolute inset-0 paper-grain opacity-30 pointer-events-none" />
      <div className="relative mx-auto max-w-2xl px-5 py-8 md:py-12">
        <div className="flex items-center justify-between gap-3">
          <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
            <Link to="/app">
              <ArrowLeft className="mr-1 h-4 w-4" /> Schedule
            </Link>
          </Button>
          <Button onClick={openNew}>
            <Plus className="mr-1.5 h-4 w-4" /> New routine
          </Button>
        </div>

        <div className="mt-6">
          <p className="flex items-center gap-2 text-sm font-medium text-accent">
            <Repeat2 className="h-4 w-4" /> Repeat without re-entering
          </p>
          <h1 className="mt-2 font-serif text-4xl text-foreground">Personal routines</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Put the repeating parts of life on the same timeline as meetings and tasks. Chronos-V
            keeps recurring time ready automatically—including birthdays and annual commitments.
          </p>
        </div>

        <div className="mt-5 flex items-start gap-2 rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Routines are private to your account. Fixed routines are protected from replanning;
            flexible routines may move when your day changes.
          </p>
        </div>

        <section className="mt-8">
          {routines.isLoading ? (
            <div className="h-28 animate-pulse rounded-xl border border-border bg-card" />
          ) : routines.isError ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-5 text-sm">
              <p>Couldn't load your routines.</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => routines.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : routines.data?.length ? (
            <ul className="space-y-3">
              {routines.data.map((routine) => (
                <li
                  key={routine.id}
                  className={`rounded-xl border border-border bg-card p-5 ${routine.active ? "" : "opacity-60"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate font-serif text-xl">{routine.title}</h2>
                        <Badge variant="secondary">{CATEGORY_LABELS[routine.category]}</Badge>
                        {!routine.active && <Badge variant="outline">Paused</Badge>}
                      </div>
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                        <CalendarClock className="h-3.5 w-3.5" /> {routineCadenceLabel(routine)}
                        {routine.is_all_day
                          ? " · All day"
                          : ` at ${format(new Date(`2000-01-01T${routine.local_time}`), "h:mm a")} · ${routine.duration_min} min`}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {routine.commitment_type === "fixed"
                          ? "Fixed commitment"
                          : "Flexible time block"}
                        {routine.location ? ` · ${routine.location}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={routine.active ? "Pause routine" : "Resume routine"}
                        onClick={() => toggle.mutate(routine)}
                        disabled={toggle.isPending}
                      >
                        {routine.active ? (
                          <Pause className="h-4 w-4" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Edit routine"
                        onClick={() => openEdit(routine)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete routine"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleting(routine)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-xl border border-dashed border-border px-5 py-12 text-center">
              <Repeat2 className="mx-auto h-7 w-7 text-muted-foreground" />
              <p className="mt-3 font-medium">No routines yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add medication, exercise, school pickup, chores, birthdays, bills, or pet care.
              </p>
              <Button className="mt-4" onClick={openNew}>
                Create your first routine
              </Button>
            </div>
          )}
        </section>
      </div>

      <RoutineDialog
        open={editing !== undefined}
        editing={Boolean(editing)}
        draft={draft}
        setDraft={setDraft}
        saving={save.isPending}
        onClose={() => setEditing(undefined)}
        onSubmit={submit}
      />

      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleting?.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              Upcoming occurrences will be removed. Past timeline entries will remain as history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && remove.mutate(deleting)}
              disabled={remove.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove routine
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RoutineDialog({
  open,
  editing,
  draft,
  setDraft,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean;
  editing: boolean;
  draft: RoutineDraft;
  setDraft: React.Dispatch<React.SetStateAction<RoutineDraft>>;
  saving: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const set = <K extends keyof RoutineDraft>(key: K, value: RoutineDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const toggleDay = (day: number) =>
    set(
      "days_of_week",
      draft.days_of_week.includes(day)
        ? draft.days_of_week.filter((value) => value !== day)
        : [...draft.days_of_week, day].sort(),
    );
  const setCategory = (category: RoutineCategory) =>
    setDraft((current) =>
      category === "birthday"
        ? {
            ...current,
            category,
            frequency: "yearly",
            is_all_day: true,
            commitment_type: "fixed",
            local_time: "00:00",
          }
        : { ...current, category },
    );
  const setFrequency = (frequency: RoutineFrequency) =>
    setDraft((current) => ({
      ...current,
      frequency,
      is_all_day:
        current.category === "birthday" ? true : frequency === "yearly" && current.is_all_day,
    }));
  const setAnnualMonth = (month: string) =>
    setDraft((current) => ({
      ...current,
      annual_month: month,
      annual_day: String(Math.min(Number(current.annual_day), daysInAnnualMonth(Number(month)))),
    }));

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit routine" : "New routine"}</DialogTitle>
          <DialogDescription>
            Chronos-V creates ordinary timeline entries, so reminders and planning work
            automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="routine-title">Name</Label>
            <Input
              id="routine-title"
              value={draft.title}
              onChange={(event) => set("title", event.target.value)}
              placeholder="Take evening medication"
              maxLength={200}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="routine-category">Category</Label>
            <select
              id="routine-category"
              value={draft.category}
              onChange={(event) => setCategory(event.target.value as RoutineCategory)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="routine-frequency">Repeats</Label>
            <select
              id="routine-frequency"
              value={draft.frequency}
              onChange={(event) => setFrequency(event.target.value as RoutineFrequency)}
              disabled={draft.category === "birthday"}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="daily">Every day</option>
              <option value="weekly">Selected weekdays</option>
              <option value="yearly">Once a year</option>
            </select>
          </div>

          {draft.frequency === "weekly" && (
            <fieldset className="space-y-2 sm:col-span-2">
              <legend className="text-sm font-medium">Days</legend>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((day) => {
                  const selected = draft.days_of_week.includes(day.value);
                  return (
                    <button
                      key={day.value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleDay(day.value)}
                      className={`rounded-full border px-3 py-1.5 text-xs transition ${
                        selected
                          ? "border-accent bg-accent text-accent-foreground"
                          : "border-border text-muted-foreground hover:border-foreground/40"
                      }`}
                    >
                      {day.short}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          {draft.frequency === "yearly" && (
            <fieldset className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
              <legend className="mb-2 text-sm font-medium">Annual date</legend>
              <div className="space-y-1.5">
                <Label htmlFor="routine-month">Month</Label>
                <select
                  id="routine-month"
                  value={draft.annual_month}
                  onChange={(event) => setAnnualMonth(event.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {MONTHS.map((month) => (
                    <option key={month.value} value={month.value}>
                      {month.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="routine-day">Day</Label>
                <select
                  id="routine-day"
                  value={draft.annual_day}
                  onChange={(event) => set("annual_day", event.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {Array.from(
                    { length: daysInAnnualMonth(Number(draft.annual_month)) },
                    (_, index) => index + 1,
                  ).map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  ))}
                </select>
              </div>
              {draft.annual_month === "2" && draft.annual_day === "29" && (
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  In non-leap years, Chronos-V places this on February 28.
                </p>
              )}
            </fieldset>
          )}

          {draft.frequency === "yearly" && (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={draft.is_all_day}
                onChange={(event) => set("is_all_day", event.target.checked)}
                disabled={draft.category === "birthday"}
                className="h-4 w-4 rounded border-input accent-accent"
              />
              All-day commitment
            </label>
          )}

          {!draft.is_all_day && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="routine-time">Time</Label>
                <Input
                  id="routine-time"
                  type="time"
                  value={draft.local_time}
                  onChange={(event) => set("local_time", event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="routine-duration">Duration (minutes)</Label>
                <Input
                  id="routine-duration"
                  type="number"
                  min={5}
                  max={480}
                  step={5}
                  value={draft.duration_min}
                  onChange={(event) => set("duration_min", event.target.value)}
                />
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="routine-start">
              {draft.frequency === "yearly" ? "Track from" : "Starts"}
            </Label>
            <Input
              id="routine-start"
              type="date"
              value={draft.start_date}
              onChange={(event) => set("start_date", event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="routine-end">Ends (optional)</Label>
            <Input
              id="routine-end"
              type="date"
              min={draft.start_date}
              value={draft.end_date}
              onChange={(event) => set("end_date", event.target.value)}
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="routine-commitment">Planning behavior</Label>
            <select
              id="routine-commitment"
              value={draft.commitment_type}
              onChange={(event) => set("commitment_type", event.target.value as RoutineCommitment)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="fixed">Fixed — never move automatically</option>
              <option value="flexible">Flexible — may move when replanning</option>
            </select>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="routine-location">Location (optional)</Label>
            <Input
              id="routine-location"
              value={draft.location}
              onChange={(event) => set("location", event.target.value)}
              maxLength={200}
              placeholder="Home, gym, school…"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="routine-notes">Notes (optional)</Label>
            <Textarea
              id="routine-notes"
              value={draft.notes}
              onChange={(event) => set("notes", event.target.value)}
              maxLength={1000}
              rows={3}
              placeholder="Anything you want available with each occurrence"
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Timezone: {draft.timezone}. Change your device timezone before creating the routine if
          this is wrong.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={saving}>
            {saving ? "Saving…" : editing ? "Save changes" : "Create routine"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
