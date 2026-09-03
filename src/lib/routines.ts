export type RoutineCategory =
  | "medication"
  | "exercise"
  | "pickup"
  | "meal"
  | "household"
  | "bill"
  | "pet"
  | "other";

export type RoutineFrequency = "daily" | "weekly";
export type RoutineCommitment = "fixed" | "flexible";

export type RoutineDefinition = {
  id: string;
  title: string;
  category: RoutineCategory;
  frequency: RoutineFrequency;
  days_of_week: number[];
  local_time: string;
  duration_min: number;
  start_date: string;
  end_date: string | null;
  timezone: string;
  location: string | null;
  notes: string | null;
  commitment_type: RoutineCommitment;
  active: boolean;
};

export type RoutineOccurrence = {
  occurrenceDate: string;
  startsAt: string;
  endsAt: string;
  recurrenceRule: string;
};

export const ROUTINE_WINDOW_DAYS = 42;

export const WEEKDAYS = [
  { value: 0, short: "Sun", rule: "SU" },
  { value: 1, short: "Mon", rule: "MO" },
  { value: 2, short: "Tue", rule: "TU" },
  { value: 3, short: "Wed", rule: "WE" },
  { value: 4, short: "Thu", rule: "TH" },
  { value: 5, short: "Fri", rule: "FR" },
  { value: 6, short: "Sat", rule: "SA" },
] as const;

export function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Invalid routine date.");
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function dateFromKey(value: string) {
  const { year, month, day } = parseDateKey(value);
  return new Date(Date.UTC(year, month - 1, day));
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addUtcDays(value: Date, amount: number) {
  return new Date(value.getTime() + amount * 86400000);
}

function zonedParts(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Convert a routine's wall-clock date/time to UTC without using the server's timezone. */
export function zonedDateTimeToUtc(date: string, time: string, timeZone: string) {
  if (!isValidTimeZone(timeZone)) throw new Error("Invalid routine timezone.");
  const { year, month, day } = parseDateKey(date);
  const timeMatch = /^(\d{2}):(\d{2})/.exec(time);
  if (!timeMatch) throw new Error("Invalid routine time.");
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const wantedWallTime = Date.UTC(year, month - 1, day, hour, minute, 0);
  let candidate = wantedWallTime;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = zonedParts(new Date(candidate), timeZone);
    const actualWallTime = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const correction = wantedWallTime - actualWallTime;
    candidate += correction;
    if (correction === 0) break;
  }

  return new Date(candidate);
}

export function routineRecurrenceRule(routine: RoutineDefinition) {
  if (routine.frequency === "daily") return "FREQ=DAILY";
  const selected = new Set(routine.days_of_week);
  const days = WEEKDAYS.filter((day) => selected.has(day.value)).map((day) => day.rule);
  return `FREQ=WEEKLY;BYDAY=${days.join(",")}`;
}

export function generateRoutineOccurrences(
  routine: RoutineDefinition,
  fromDate: string,
  windowDays = ROUTINE_WINDOW_DAYS,
) {
  if (!routine.active || windowDays < 1) return [];
  const requestedStart = dateFromKey(fromDate);
  const routineStart = dateFromKey(routine.start_date);
  const start = requestedStart > routineStart ? requestedStart : routineStart;
  const windowEnd = addUtcDays(requestedStart, windowDays - 1);
  const routineEnd = routine.end_date ? dateFromKey(routine.end_date) : null;
  const end = routineEnd && routineEnd < windowEnd ? routineEnd : windowEnd;
  if (start > end) return [];

  const selectedDays = new Set(routine.days_of_week);
  const recurrenceRule = routineRecurrenceRule(routine);
  const occurrences: RoutineOccurrence[] = [];

  for (let current = start; current <= end; current = addUtcDays(current, 1)) {
    if (routine.frequency === "weekly" && !selectedDays.has(current.getUTCDay())) continue;
    const occurrenceDate = dateKey(current);
    const starts = zonedDateTimeToUtc(occurrenceDate, routine.local_time, routine.timezone);
    const ends = new Date(starts.getTime() + routine.duration_min * 60000);
    occurrences.push({
      occurrenceDate,
      startsAt: starts.toISOString(),
      endsAt: ends.toISOString(),
      recurrenceRule,
    });
  }

  return occurrences;
}

export function routineCadenceLabel(routine: RoutineDefinition) {
  if (routine.frequency === "daily") return "Every day";
  const selected = new Set(routine.days_of_week);
  return WEEKDAYS.filter((day) => selected.has(day.value))
    .map((day) => day.short)
    .join(", ");
}
