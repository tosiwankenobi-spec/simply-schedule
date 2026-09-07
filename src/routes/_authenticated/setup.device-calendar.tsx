import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DeviceCalendar } from "@capacitor/calendar";
import { format } from "date-fns";
import {
  CalendarArrowUp,
  CheckCircle2,
  Eye,
  HardDrive,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
} from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import {
  deleteNativeDeviceCalendarCopies,
  getNativeDeviceCalendarStatus,
  syncNativeDeviceCalendars,
} from "@/lib/device-calendar.functions";
import {
  DEVICE_CALENDAR_MAX_CALENDARS,
  checkDeviceCalendarPermission,
  clearDeviceCalendarPreferences,
  isNativeDeviceCalendarAvailable,
  listDeviceCalendars,
  loadDeviceCalendarPreferences,
  previewDeviceCalendars,
  requestDeviceCalendarPermission,
  saveDeviceCalendarPreferences,
  type DeviceCalendarPermission,
  type DeviceCalendarPreview,
} from "@/lib/device-calendar";

export const Route = createFileRoute("/_authenticated/setup/device-calendar")({
  component: DeviceCalendarSetupPage,
  head: () => ({
    meta: [
      { title: "Device calendars · Chronos-V" },
      {
        name: "description",
        content:
          "Privately preview selected device calendars and import read-only copies into Chronos-V.",
      },
    ],
  }),
});

function DeviceCalendarSetupPage() {
  const { user } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const nativeAvailable = isNativeDeviceCalendarAvailable();
  const [preferences, setPreferences] = useState(() => loadDeviceCalendarPreferences(user.id));
  const [permission, setPermission] = useState<DeviceCalendarPermission>("prompt");
  const [calendars, setCalendars] = useState<DeviceCalendar[]>([]);
  const [preview, setPreview] = useState<DeviceCalendarPreview | null>(null);
  const [reading, setReading] = useState(false);

  const status = useQuery({
    queryKey: ["device-calendar-status", preferences.deviceId],
    queryFn: () => getNativeDeviceCalendarStatus({ data: { deviceId: preferences.deviceId } }),
    enabled: nativeAvailable,
  });

  useEffect(() => {
    if (!nativeAvailable) return;
    saveDeviceCalendarPreferences(user.id, preferences);
  }, [nativeAvailable, preferences, user.id]);

  useEffect(() => {
    if (!nativeAvailable) return;
    let active = true;
    void checkDeviceCalendarPermission()
      .then(async (state) => {
        if (!active) return;
        setPermission(state);
        if (state === "granted") {
          const available = await listDeviceCalendars();
          if (active) setCalendars(available);
        }
      })
      .catch(() => {
        if (active) setPermission("denied");
      });
    return () => {
      active = false;
    };
  }, [nativeAvailable]);

  const refreshSchedule = () => {
    queryClient.invalidateQueries({ queryKey: ["device-calendar-status"] });
    queryClient.invalidateQueries({ queryKey: ["calendar-imports"] });
    queryClient.invalidateQueries({ queryKey: ["appointments"] });
    queryClient.invalidateQueries({ queryKey: ["day-replan-preview"] });
    queryClient.invalidateQueries({ queryKey: ["weekly-reset-preview"] });
  };

  const sync = useMutation({
    mutationFn: () => {
      if (!preview || preview.calendars.length === 0) {
        throw new Error("Preview at least one calendar first.");
      }
      return syncNativeDeviceCalendars({
        data: { deviceId: preferences.deviceId, calendars: preview.calendars },
      });
    },
    onSuccess: (result) => {
      refreshSchedule();
      toast.success(
        `Refreshed ${result.imported} event${result.imported === 1 ? "" : "s"}${
          result.removed > 0
            ? ` and removed ${result.removed} stale copy${result.removed === 1 ? "" : "s"}`
            : ""
        }.`,
      );
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Couldn't refresh device calendars."),
  });

  const remove = useMutation({
    mutationFn: () =>
      deleteNativeDeviceCalendarCopies({ data: { deviceId: preferences.deviceId } }),
    onSuccess: (result) => {
      refreshSchedule();
      toast.success(
        `Deleted ${result.removed} Chronos-V cop${result.removed === 1 ? "y" : "ies"}.`,
      );
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Couldn't delete imported copies."),
  });

  async function allowReadAccess() {
    try {
      const state = await requestDeviceCalendarPermission();
      setPermission(state);
      if (state !== "granted") {
        toast.error("Calendar read access was not granted. You can enable it in device settings.");
        return;
      }
      setCalendars(await listDeviceCalendars());
      toast.success("Calendar read access granted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't request calendar access.");
    }
  }

  function toggleCalendar(calendarId: string, checked: boolean) {
    setPreview(null);
    setPreferences((current) => {
      const selected = checked
        ? [...new Set([...current.selectedCalendarIds, calendarId])].slice(
            0,
            DEVICE_CALENDAR_MAX_CALENDARS,
          )
        : current.selectedCalendarIds.filter((id) => id !== calendarId);
      if (
        checked &&
        selected.length === current.selectedCalendarIds.length &&
        !current.selectedCalendarIds.includes(calendarId)
      ) {
        toast.error(`Choose up to ${DEVICE_CALENDAR_MAX_CALENDARS} calendars.`);
      }
      return { ...current, selectedCalendarIds: selected };
    });
  }

  async function buildPreview() {
    if (preferences.selectedCalendarIds.length === 0) {
      toast.error("Choose at least one calendar.");
      return;
    }
    setReading(true);
    setPreview(null);
    try {
      const next = await previewDeviceCalendars(calendars, preferences.selectedCalendarIds);
      setPreview(next);
      if (next.eventCount === 0) toast.info("No events were found in the import window.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't read device calendars.");
    } finally {
      setReading(false);
    }
  }

  function disconnect() {
    clearDeviceCalendarPreferences(user.id);
    const next = { ...preferences, selectedCalendarIds: [] };
    saveDeviceCalendarPreferences(user.id, next);
    setPreferences(next);
    setPreview(null);
    toast.success("Device calendar selection disconnected");
  }

  return (
    <div className="verolane-wash relative min-h-screen bg-background">
      <div className="paper-grain pointer-events-none absolute inset-0 opacity-20" />
      <div className="relative mx-auto max-w-[1180px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <WorkspaceHeader
          eyebrow="Device calendars"
          title={
            <>
              Your phone's schedule, <span className="text-accent italic">with permission.</span>
            </>
          }
          description="Choose calendars, preview exactly what Chronos-V found, then approve a read-only copy for planning. Your original device events are never changed."
          action={
            <Button asChild variant="outline" className="bg-card/80">
              <Link to="/privacy">
                <ShieldCheck className="mr-1.5 h-4 w-4" /> Privacy controls
              </Link>
            </Button>
          }
        />

        {!nativeAvailable ? (
          <Card className="mt-8 rounded-2xl bg-card/90">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Smartphone className="h-5 w-5" /> Open Chronos-V on your phone
              </CardTitle>
              <CardDescription>
                Direct device access is available only in the installed mobile app. On desktop or
                the web, export an iCalendar file and preview it before importing.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link to="/calendar-import">
                  <CalendarArrowUp className="mr-1.5 h-4 w-4" /> Import an iCalendar file
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="mt-8 grid items-start gap-6 xl:grid-cols-2">
            <Card className="rounded-2xl bg-card/90 shadow-[0_18px_45px_rgba(0,46,40,0.04)]">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>1. Allow read access</CardTitle>
                    <CardDescription>
                      Chronos-V requests calendar reading only. It does not request permission to
                      create, edit, or delete device events.
                    </CardDescription>
                  </div>
                  <Badge variant={permission === "granted" ? "secondary" : "outline"}>
                    {permission === "granted" ? "Read access active" : "Permission required"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 text-sm sm:grid-cols-3">
                  <div className="rounded-xl border p-3">
                    <Eye className="mb-2 h-4 w-4 text-accent" />
                    <p className="font-medium">Reads</p>
                    <p className="text-muted-foreground">Titles, times, locations, and notes.</p>
                  </div>
                  <div className="rounded-xl border p-3">
                    <CheckCircle2 className="mb-2 h-4 w-4 text-accent" />
                    <p className="font-medium">Why</p>
                    <p className="text-muted-foreground">Planning and conflict prevention.</p>
                  </div>
                  <div className="rounded-xl border p-3">
                    <HardDrive className="mb-2 h-4 w-4 text-accent" />
                    <p className="font-medium">Stores</p>
                    <p className="text-muted-foreground">Only copies you explicitly approve.</p>
                  </div>
                </div>
                {permission !== "granted" ? (
                  <Button onClick={() => void allowReadAccess()}>Allow calendar read access</Button>
                ) : null}
                <p className="text-xs leading-5 text-muted-foreground">
                  On iPhone, iOS may call its calendar-reading permission “Full Access.” Chronos-V
                  still uses only read operations and never calls the calendar write APIs.
                </p>
              </CardContent>
            </Card>

            <Card className="rounded-2xl bg-card/90 shadow-[0_18px_45px_rgba(0,46,40,0.04)]">
              <CardHeader>
                <CardTitle>2. Choose calendars</CardTitle>
                <CardDescription>
                  Nothing is selected automatically. Choose up to {DEVICE_CALENDAR_MAX_CALENDARS}.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {permission !== "granted" ? (
                  <p className="text-sm text-muted-foreground">
                    Allow read access to see calendars.
                  </p>
                ) : calendars.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No calendars are available.</p>
                ) : (
                  <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                    {calendars.map((calendar) => {
                      const checked = preferences.selectedCalendarIds.includes(calendar.id);
                      const label = calendar.displayName || calendar.name || "Device calendar";
                      return (
                        <label
                          key={calendar.id}
                          className="flex cursor-pointer items-center gap-3 rounded-xl border p-3 hover:bg-secondary/40"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(value) => toggleCalendar(calendar.id, Boolean(value))}
                          />
                          <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
                          {calendar.isPrimary ? <Badge variant="outline">Primary</Badge> : null}
                        </label>
                      );
                    })}
                  </div>
                )}
                <Button
                  onClick={() => void buildPreview()}
                  disabled={
                    permission !== "granted" ||
                    preferences.selectedCalendarIds.length === 0 ||
                    reading
                  }
                >
                  <Eye className="mr-1.5 h-4 w-4" />
                  {reading ? "Reading on this device…" : "Preview selected calendars"}
                </Button>
              </CardContent>
            </Card>

            <Card className="rounded-2xl bg-card/90 shadow-[0_18px_45px_rgba(0,46,40,0.04)] xl:col-span-2">
              <CardHeader>
                <CardTitle>3. Review and refresh</CardTitle>
                <CardDescription>
                  The preview stays on this device until you approve it. Refreshing updates
                  Chronos-V copies and removes stale copies within the selected calendars.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!preview ? (
                  <p className="text-sm text-muted-foreground">
                    Choose calendars and build a preview to continue.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">
                        {preview.eventCount} event{preview.eventCount === 1 ? "" : "s"}
                      </Badge>
                      <Badge variant="outline">
                        {preview.calendars.length} calendar
                        {preview.calendars.length === 1 ? "" : "s"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(preview.windowStart), "MMM d, yyyy")}–
                        {format(new Date(preview.windowEnd), "MMM d, yyyy")}
                      </span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {preview.calendars.map((calendar) => (
                        <div key={calendar.calendarId} className="rounded-xl border p-4">
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-medium">{calendar.calendarName}</p>
                            <Badge variant="outline">{calendar.events.length}</Badge>
                          </div>
                          <div className="mt-3 space-y-2">
                            {calendar.events.slice(0, 3).map((event) => (
                              <div
                                key={`${event.nativeEventId}:${event.occurrenceKey}`}
                                className="flex items-start justify-between gap-3 text-sm"
                              >
                                <span className="truncate">{event.title}</span>
                                <span className="shrink-0 text-xs text-muted-foreground">
                                  {format(new Date(event.startsAt), "MMM d · h:mm a")}
                                </span>
                              </div>
                            ))}
                            {calendar.events.length === 0 ? (
                              <p className="text-xs text-muted-foreground">No events in range.</p>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                    {preview.skipped > 0 || preview.calendars.some((item) => item.truncated) ? (
                      <Alert>
                        <AlertTitle>Import limits applied</AlertTitle>
                        <AlertDescription>
                          {preview.skipped > 0
                            ? `${preview.skipped} invalid or out-of-range item${preview.skipped === 1 ? " was" : "s were"} skipped. `
                            : ""}
                          {preview.calendars.some((item) => item.truncated)
                            ? "A calendar reached the 500-event preview limit."
                            : ""}
                        </AlertDescription>
                      </Alert>
                    ) : null}
                    <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
                      <RefreshCw
                        className={`mr-1.5 h-4 w-4 ${sync.isPending ? "animate-spin" : ""}`}
                      />
                      {sync.isPending
                        ? "Refreshing…"
                        : `Approve and refresh ${preview.eventCount} events`}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-dashed bg-card/70 xl:col-span-2">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <CardTitle>Your imported copies</CardTitle>
                    <CardDescription>
                      {status.data?.importedItems
                        ? `${status.data.importedItems} event${status.data.importedItems === 1 ? "" : "s"} from this device.`
                        : "No approved copies from this device."}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={disconnect}
                      disabled={preferences.selectedCalendarIds.length === 0}
                    >
                      Disconnect selection
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          className="text-destructive"
                          disabled={!status.data?.importedItems || remove.isPending}
                        >
                          <Trash2 className="mr-1.5 h-4 w-4" /> Delete Chronos-V copies
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete copies from this device?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This deletes only imported Chronos-V appointments. Events in your
                            phone's calendars will not be changed or deleted.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Keep copies</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => remove.mutate()}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Delete copies
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </CardHeader>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
