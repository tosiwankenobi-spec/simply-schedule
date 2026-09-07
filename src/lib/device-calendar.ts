import { Capacitor } from "@capacitor/core";
import type { PermissionState } from "@capacitor/core";
import type { CalendarEvent as NativeCalendarEvent, DeviceCalendar } from "@capacitor/calendar";

export const DEVICE_CALENDAR_MAX_CALENDARS = 10;
export const DEVICE_CALENDAR_MAX_EVENTS_PER_CALENDAR = 500;

export type DeviceCalendarPermission = PermissionState;

export type DeviceCalendarSyncEvent = {
  nativeEventId: string;
  occurrenceKey: string;
  title: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  notes: string | null;
  timezone: string;
  isAllDay: boolean;
};

export type DeviceCalendarSyncGroup = {
  calendarId: string;
  calendarName: string;
  events: DeviceCalendarSyncEvent[];
  truncated: boolean;
};

export type DeviceCalendarPreview = {
  calendars: DeviceCalendarSyncGroup[];
  eventCount: number;
  skipped: number;
  windowStart: string;
  windowEnd: string;
};

export type DeviceCalendarPreferences = {
  version: 1;
  deviceId: string;
  selectedCalendarIds: string[];
};

function clean(value: string | null | undefined, max: number) {
  const result = value?.replace(/\0/g, "").trim();
  return result ? result.slice(0, max) : null;
}

function preferenceKey(userId: string) {
  return `chronos-v.device-calendar.v1.${userId}`;
}

function createDeviceId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

export function isNativeDeviceCalendarAvailable() {
  return Capacitor.isNativePlatform();
}

export function loadDeviceCalendarPreferences(userId: string): DeviceCalendarPreferences {
  const fallback: DeviceCalendarPreferences = {
    version: 1,
    deviceId: createDeviceId(),
    selectedCalendarIds: [],
  };

  try {
    const stored = localStorage.getItem(preferenceKey(userId));
    if (!stored) return fallback;
    const parsed = JSON.parse(stored) as Partial<DeviceCalendarPreferences>;
    if (parsed.version !== 1 || typeof parsed.deviceId !== "string") return fallback;
    return {
      version: 1,
      deviceId: parsed.deviceId.slice(0, 100),
      selectedCalendarIds: Array.isArray(parsed.selectedCalendarIds)
        ? parsed.selectedCalendarIds
            .filter((id): id is string => typeof id === "string")
            .slice(0, DEVICE_CALENDAR_MAX_CALENDARS)
        : [],
    };
  } catch {
    return fallback;
  }
}

export function saveDeviceCalendarPreferences(
  userId: string,
  preferences: DeviceCalendarPreferences,
) {
  localStorage.setItem(preferenceKey(userId), JSON.stringify(preferences));
}

export function clearDeviceCalendarPreferences(userId: string) {
  localStorage.removeItem(preferenceKey(userId));
}

export function deviceCalendarWindow(now = new Date()) {
  const start = new Date(now);
  start.setDate(start.getDate() - 30);
  const end = new Date(now);
  end.setFullYear(end.getFullYear() + 2);
  return { start, end };
}

export function buildDeviceCalendarPreview(
  calendars: DeviceCalendar[],
  events: NativeCalendarEvent[],
  selectedCalendarIds: string[],
  now = new Date(),
): DeviceCalendarPreview {
  const selected = new Set(selectedCalendarIds.slice(0, DEVICE_CALENDAR_MAX_CALENDARS));
  const { start, end } = deviceCalendarWindow(now);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const groups = new Map<string, DeviceCalendarSyncGroup>();
  const groupsByName = new Map<string, DeviceCalendarSyncGroup | null>();

  for (const calendar of calendars) {
    if (!selected.has(calendar.id)) continue;
    const group = {
      calendarId: calendar.id.slice(0, 300),
      calendarName:
        clean(calendar.displayName, 120) ?? clean(calendar.name, 120) ?? "Device calendar",
      events: [],
      truncated: false,
    } satisfies DeviceCalendarSyncGroup;
    groups.set(calendar.id, group);
    groupsByName.set(calendar.name, groupsByName.has(calendar.name) ? null : group);
  }

  const seen = new Set<string>();
  let skipped = 0;
  for (const event of events) {
    const calendarId = event.calendarId;
    const group = calendarId
      ? groups.get(calendarId)
      : event.calendarName
        ? (groupsByName.get(event.calendarName) ?? undefined)
        : undefined;
    if (!group) continue;
    const startDate = new Date(event.startDate);
    const rawEndDate = new Date(event.endDate);
    if (!Number.isFinite(startDate.getTime()) || startDate < start || startDate > end) {
      skipped++;
      continue;
    }

    const nativeEventId = clean(event.id, 500);
    if (!nativeEventId) {
      skipped++;
      continue;
    }
    const uniqueKey = `${group.calendarId}\0${nativeEventId}\0${startDate.toISOString()}`;
    if (seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);

    if (group.events.length >= DEVICE_CALENDAR_MAX_EVENTS_PER_CALENDAR) {
      group.truncated = true;
      continue;
    }

    const fallbackDuration = event.isAllDay ? 24 * 60 * 60 * 1000 : 30 * 60 * 1000;
    const endDate =
      Number.isFinite(rawEndDate.getTime()) && rawEndDate > startDate
        ? rawEndDate
        : new Date(startDate.getTime() + fallbackDuration);
    group.events.push({
      nativeEventId,
      occurrenceKey: startDate.toISOString(),
      title: clean(event.title, 200) ?? "Untitled event",
      startsAt: startDate.toISOString(),
      endsAt: endDate.toISOString(),
      location: clean(event.location, 200),
      notes: clean(event.notes, 1000),
      timezone,
      isAllDay: Boolean(event.isAllDay),
    });
  }

  const output = [...groups.values()];
  for (const group of output) {
    group.events.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }
  output.sort((a, b) => a.calendarName.localeCompare(b.calendarName));

  return {
    calendars: output,
    eventCount: output.reduce((count, group) => count + group.events.length, 0),
    skipped,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
  };
}

async function nativeCalendar() {
  const { Calendar } = await import("@capacitor/calendar");
  return Calendar;
}

export async function checkDeviceCalendarPermission(): Promise<DeviceCalendarPermission> {
  if (!isNativeDeviceCalendarAvailable()) return "denied";
  const calendar = await nativeCalendar();
  return (await calendar.checkPermissions()).readCalendar;
}

export async function requestDeviceCalendarPermission(): Promise<DeviceCalendarPermission> {
  if (!isNativeDeviceCalendarAvailable()) return "denied";
  const calendar = await nativeCalendar();
  return (await calendar.requestPermissions({ permissions: ["readCalendar"] })).readCalendar;
}

export async function listDeviceCalendars() {
  const calendar = await nativeCalendar();
  return (await calendar.listCalendars()).calendars;
}

export async function previewDeviceCalendars(
  calendars: DeviceCalendar[],
  selectedCalendarIds: string[],
  now = new Date(),
) {
  const calendar = await nativeCalendar();
  const { start, end } = deviceCalendarWindow(now);
  const selectedIds = new Set(selectedCalendarIds.slice(0, DEVICE_CALENDAR_MAX_CALENDARS));
  const selectedNames = [
    ...new Set(
      calendars
        .filter((item) => selectedIds.has(item.id))
        .map((item) => item.name.trim())
        .filter(Boolean),
    ),
  ];
  const results = await Promise.all(
    selectedNames.map((calendarName) =>
      calendar.findEvents({
        startDate: start.getTime(),
        endDate: end.getTime(),
        calendarName,
      }),
    ),
  );
  const events = results.flatMap((result) => result.events);
  return buildDeviceCalendarPreview(calendars, events, selectedCalendarIds, now);
}
