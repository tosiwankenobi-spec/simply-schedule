import {
  calculateTravelGuidance,
  DEFAULT_TRAVEL_PREFERENCES,
  type TravelPreferences,
} from "./travel-intelligence";

export type ReminderAppointment = {
  id: string;
  title: string;
  starts_at: string;
  location: string | null;
  notes: string | null;
  source: string;
  commitment_type: string;
  is_all_day: boolean;
  travel_minutes?: number | null;
  preparation_minutes?: number | null;
};

export type AdaptiveReminderSignal = {
  key: "online" | "travel" | "prepare";
  leadMinutes: number | null;
  label: string;
  reason: string;
};

const ONLINE_PATTERN =
  /\b(google meet|meet\.google|zoom|teams|webex|skype|facetime|video call|video meeting|online|virtual)\b/i;
const MEETING_LINK_PATTERN =
  /https?:\/\/(?:[\w-]+\.)?(?:zoom\.us|meet\.google\.com|teams\.microsoft\.com|webex\.com|whereby\.com)\b/i;
const PREPARATION_PATTERN =
  /\b(appointment|dentist|doctor|clinic|interview|exam|flight|airport|school|pickup|pick-up|reservation|renewal|deadline|hearing|court|presentation)\b/i;

function zonedParts(value: number | string, timeZone: string) {
  const date = new Date(value);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "00";
    return {
      dateKey: `${get("year")}-${get("month")}-${get("day")}`,
      minutes: Number(get("hour")) * 60 + Number(get("minute")),
    };
  } catch {
    return {
      dateKey: date.toISOString().slice(0, 10),
      minutes: date.getUTCHours() * 60 + date.getUTCMinutes(),
    };
  }
}

function nextDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + 1)).toISOString().slice(0, 10);
}

function appointmentText(appointment: ReminderAppointment) {
  return [appointment.title, appointment.location, appointment.notes].filter(Boolean).join(" ");
}

export function isOnlineAppointment(appointment: ReminderAppointment) {
  const text = appointmentText(appointment);
  return ONLINE_PATTERN.test(text) || MEETING_LINK_PATTERN.test(text);
}

export function hasPhysicalLocation(appointment: ReminderAppointment) {
  return Boolean(appointment.location?.trim()) && !isOnlineAppointment(appointment);
}

export function isPreparationWorthy(appointment: ReminderAppointment, timeZone: string) {
  if (
    appointment.is_all_day ||
    appointment.commitment_type !== "fixed" ||
    appointment.source === "task"
  ) {
    return false;
  }
  const localStart = zonedParts(appointment.starts_at, timeZone);
  const startsBeforeTen = localStart.minutes < 10 * 60;
  return (
    hasPhysicalLocation(appointment) ||
    startsBeforeTen ||
    PREPARATION_PATTERN.test(appointmentText(appointment))
  );
}

export function getAdaptiveReminderSignals(
  appointment: ReminderAppointment,
  timeZone: string,
  travelPreferences: TravelPreferences = DEFAULT_TRAVEL_PREFERENCES,
): AdaptiveReminderSignal[] {
  if (appointment.is_all_day) return [];

  const signals: AdaptiveReminderSignal[] = [];
  if (isOnlineAppointment(appointment)) {
    signals.push({
      key: "online",
      leadMinutes: 5,
      label: "5 minutes before",
      reason: "Online meeting — enough time to open the link and join.",
    });
  } else if (hasPhysicalLocation(appointment)) {
    const travel = calculateTravelGuidance(appointment, travelPreferences);
    if (travel && travelPreferences.travel_reminders_enabled) {
      const leadMinutes = travel.travelMinutes + travel.bufferMinutes;
      signals.push({
        key: "travel",
        leadMinutes,
        label: `${leadMinutes} minutes before`,
        reason: `${travel.travelMinutes} minutes of travel plus a ${travel.bufferMinutes}-minute safety buffer.`,
      });
    }
  }

  if (isPreparationWorthy(appointment, timeZone)) {
    signals.push({
      key: "prepare",
      leadMinutes: null,
      label: "The evening before",
      reason: "Fixed commitment that may need preparation or an early start.",
    });
  }
  return signals;
}

export function isEveningBefore(input: { nowMs: number; startsAt: string; timeZone: string }) {
  const now = zonedParts(input.nowMs, input.timeZone);
  const appointment = zonedParts(input.startsAt, input.timeZone);
  return (
    now.minutes >= 18 * 60 &&
    now.minutes < 21 * 60 &&
    appointment.dateKey === nextDateKey(now.dateKey)
  );
}
