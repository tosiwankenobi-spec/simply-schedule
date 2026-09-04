import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarArrowUp, FileCheck2, HardDrive, Laptop, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import {
  deleteCalendarImport,
  getCalendarImports,
  importCalendarEvents,
} from "@/lib/calendar-import.functions";
import type { CalendarImportKind, CalendarImportPreview } from "@/lib/calendar-import";

export const Route = createFileRoute("/_authenticated/calendar-import")({
  component: CalendarImportPage,
  head: () => ({
    meta: [
      { title: "Import calendars · Chronos-V" },
      {
        name: "description",
        content: "Preview and import Outlook, Apple, Android, or other iCalendar files.",
      },
    ],
  }),
});

const MAX_FILE_BYTES = 2 * 1024 * 1024;

function sourceLabel(kind: CalendarImportKind) {
  return kind === "outlook" ? "Outlook" : "Device calendar";
}

function CalendarImportPage() {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<CalendarImportKind>("outlook");
  const [preview, setPreview] = useState<CalendarImportPreview | null>(null);
  const [parsing, setParsing] = useState(false);

  const imports = useQuery({ queryKey: ["calendar-imports"], queryFn: () => getCalendarImports() });
  const refreshSchedule = () => {
    queryClient.invalidateQueries({ queryKey: ["calendar-imports"] });
    queryClient.invalidateQueries({ queryKey: ["appointments"] });
    queryClient.invalidateQueries({ queryKey: ["day-replan-preview"] });
    queryClient.invalidateQueries({ queryKey: ["weekly-reset-preview"] });
  };

  const save = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error("Choose a calendar file first.");
      return importCalendarEvents({
        data: {
          kind,
          calendarName: preview.calendarName,
          events: preview.events,
        },
      });
    },
    onSuccess: (result) => {
      refreshSchedule();
      toast.success(
        `Imported ${result.imported} event${result.imported === 1 ? "" : "s"} from ${result.calendarName}.`,
      );
      setPreview(null);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Import failed."),
  });

  const remove = useMutation({
    mutationFn: (input: { kind: CalendarImportKind; calendarName: string }) =>
      deleteCalendarImport({ data: input }),
    onSuccess: (result) => {
      refreshSchedule();
      toast.success(`Removed ${result.removed} imported event${result.removed === 1 ? "" : "s"}.`);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Couldn't delete import."),
  });

  const readFile = async (file: File | undefined) => {
    setPreview(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".ics")) {
      toast.error("Choose an .ics calendar file.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast.error("Calendar files must be 2 MB or smaller.");
      return;
    }
    setParsing(true);
    try {
      const text = await file.text();
      const { parseCalendarFile } = await import("@/lib/calendar-import");
      setPreview(parseCalendarFile(text, file.name));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't read that calendar file.");
    } finally {
      setParsing(false);
    }
  };

  return (
    <div className="verolane-wash relative min-h-screen bg-background">
      <div className="pointer-events-none absolute inset-0 paper-grain opacity-20" />
      <div className="relative mx-auto max-w-[1180px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <WorkspaceHeader
          eyebrow="Calendar import"
          title={
            <>
              Bring every calendar <span className="text-accent italic">together.</span>
            </>
          }
          description="Export an iCalendar file from Outlook, Apple Calendar, Android, or another calendar app. Chronos-V previews it on this device before anything is saved."
        />

        <div className="mt-8 grid items-start gap-6 xl:grid-cols-2">
          <Card className="rounded-2xl bg-card/90 shadow-[0_18px_45px_rgba(0,46,40,0.04)]">
            <CardHeader>
              <CardTitle>Choose a calendar file</CardTitle>
              <CardDescription>
                Imports cover the previous 30 days and next two years, including recurring events.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="calendar-source">Where did this file come from?</Label>
                <select
                  id="calendar-source"
                  value={kind}
                  onChange={(event) => setKind(event.target.value as CalendarImportKind)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <option value="outlook">Microsoft Outlook</option>
                  <option value="device">Apple, Android, or another device calendar</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="calendar-file">iCalendar file</Label>
                <Input
                  id="calendar-file"
                  type="file"
                  accept=".ics,text/calendar"
                  disabled={parsing || save.isPending}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    void readFile(file);
                  }}
                />
                <p className="text-xs text-muted-foreground">Maximum file size: 2 MB.</p>
              </div>

              {parsing ? <p className="text-sm text-muted-foreground">Reading calendar…</p> : null}

              {preview ? (
                <div className="space-y-4 rounded-xl border bg-secondary/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{preview.calendarName}</p>
                      <p className="text-sm text-muted-foreground">
                        {preview.events.length} event{preview.events.length === 1 ? "" : "s"} ready
                      </p>
                    </div>
                    <Badge variant="secondary">
                      <FileCheck2 className="mr-1 h-3.5 w-3.5" /> {sourceLabel(kind)}
                    </Badge>
                  </div>

                  <div className="space-y-2">
                    {preview.events.slice(0, 6).map((event) => (
                      <div
                        key={`${event.uid}:${event.occurrenceKey}`}
                        className="flex flex-col gap-1 rounded-xl bg-background px-3 py-2 text-sm sm:flex-row sm:items-start sm:justify-between sm:gap-3"
                      >
                        <span className="font-medium">{event.title}</span>
                        <span className="shrink-0 text-muted-foreground">
                          {format(new Date(event.startsAt), "MMM d, yyyy · h:mm a")}
                        </span>
                      </div>
                    ))}
                  </div>

                  {preview.events.length > 6 ? (
                    <p className="text-xs text-muted-foreground">
                      Plus {preview.events.length - 6} more event
                      {preview.events.length - 6 === 1 ? "" : "s"}.
                    </p>
                  ) : null}
                  {preview.skipped > 0 || preview.truncated ? (
                    <Alert>
                      <AlertTitle>Import window applied</AlertTitle>
                      <AlertDescription>
                        {preview.skipped > 0
                          ? `${preview.skipped} cancelled, invalid, or out-of-range item${preview.skipped === 1 ? " was" : "s were"} skipped. `
                          : ""}
                        {preview.truncated ? "This preview is capped at 500 events." : ""}
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  <Button onClick={() => save.mutate()} disabled={save.isPending}>
                    <CalendarArrowUp className="mr-1.5 h-4 w-4" />
                    {save.isPending ? "Importing…" : `Import ${preview.events.length} events`}
                  </Button>
                </div>
              ) : null}

              <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                <HardDrive className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  The raw file stays on this device. After approval, Chronos-V stores only
                  normalized event details in your private account. Reimporting the same events
                  updates them.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl bg-card/90 shadow-[0_18px_45px_rgba(0,46,40,0.04)]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Laptop className="h-5 w-5" /> Imported calendars
              </CardTitle>
              <CardDescription>
                File imports are one-way snapshots. Re-export and import again to pick up changes.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {imports.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading imports…</p>
              ) : imports.isError ? (
                <p className="text-sm text-destructive">
                  {imports.error instanceof Error
                    ? imports.error.message
                    : "Couldn't load imports."}
                </p>
              ) : imports.data?.length ? (
                <div className="space-y-3">
                  {imports.data.map((item) => (
                    <div
                      key={`${item.kind}:${item.calendarName}`}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3"
                    >
                      <div>
                        <p className="font-medium">{item.calendarName}</p>
                        <p className="text-sm text-muted-foreground">
                          {sourceLabel(item.kind)} · {item.count} event{item.count === 1 ? "" : "s"}
                          {item.importedAt
                            ? ` · imported ${format(new Date(item.importedAt), "MMM d, yyyy")}`
                            : ""}
                        </p>
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" className="text-destructive">
                            <Trash2 className="mr-1.5 h-4 w-4" /> Remove
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove {item.calendarName}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This deletes {item.count} imported event{item.count === 1 ? "" : "s"}
                              from Chronos-V. The original calendar file and source calendar are not
                              changed.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Keep import</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={() =>
                                remove.mutate({ kind: item.kind, calendarName: item.calendarName })
                              }
                            >
                              Remove imported events
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No calendar files imported yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
