export type TravelMode = "driving" | "transit" | "walking" | "cycling" | "other";

export type TravelPreferences = {
  travel_reminders_enabled: boolean;
  travel_mode: TravelMode;
  default_travel_min: number;
  travel_buffer_min: number;
  default_prep_min: number;
};

export type TravelAppointment = {
  id: string;
  title: string;
  starts_at: string;
  location: string | null;
  travel_minutes?: number | null;
  preparation_minutes?: number | null;
  is_all_day?: boolean;
};

export type TravelGuidance = {
  appointmentId: string;
  title: string;
  startsAt: string;
  location: string;
  mode: TravelMode;
  travelMinutes: number;
  bufferMinutes: number;
  preparationMinutes: number;
  leaveAt: string;
  prepareAt: string;
  minutesUntilLeave: number;
  status: "upcoming" | "prepare" | "leave_now" | "started";
};

export const DEFAULT_TRAVEL_PREFERENCES: TravelPreferences = {
  travel_reminders_enabled: true,
  travel_mode: "driving",
  default_travel_min: 30,
  travel_buffer_min: 10,
  default_prep_min: 10,
};

type TravelPreferenceInput = Partial<
  Omit<TravelPreferences, "travel_mode"> & { travel_mode: string | null }
>;

export function normalizeTravelPreferences(
  input: TravelPreferenceInput | null | undefined,
): TravelPreferences {
  const mode = input?.travel_mode;
  return {
    travel_reminders_enabled:
      typeof input?.travel_reminders_enabled === "boolean"
        ? input.travel_reminders_enabled
        : DEFAULT_TRAVEL_PREFERENCES.travel_reminders_enabled,
    travel_mode:
      mode === "driving" ||
      mode === "transit" ||
      mode === "walking" ||
      mode === "cycling" ||
      mode === "other"
        ? mode
        : DEFAULT_TRAVEL_PREFERENCES.travel_mode,
    default_travel_min: boundedMinutes(
      input?.default_travel_min,
      DEFAULT_TRAVEL_PREFERENCES.default_travel_min,
      1,
      720,
    ),
    travel_buffer_min: boundedMinutes(
      input?.travel_buffer_min,
      DEFAULT_TRAVEL_PREFERENCES.travel_buffer_min,
      0,
      120,
    ),
    default_prep_min: boundedMinutes(
      input?.default_prep_min,
      DEFAULT_TRAVEL_PREFERENCES.default_prep_min,
      0,
      240,
    ),
  };
}

const ONLINE_LOCATION_PATTERN =
  /(?:https?:\/\/|zoom|meet\.google|teams\.microsoft|webex|online|virtual|video call)/i;

export function isOnlineLocation(location: string | null) {
  return Boolean(location && ONLINE_LOCATION_PATTERN.test(location));
}

export function hasPhysicalTravelLocation(appointment: Pick<TravelAppointment, "location">) {
  return Boolean(appointment.location?.trim()) && !isOnlineLocation(appointment.location);
}

function boundedMinutes(
  value: number | null | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value ?? fallback)));
}

export function calculateTravelGuidance(
  appointment: TravelAppointment,
  preferences: TravelPreferences = DEFAULT_TRAVEL_PREFERENCES,
  nowMs = Date.now(),
): TravelGuidance | null {
  if (appointment.is_all_day || !hasPhysicalTravelLocation(appointment)) return null;
  const startMs = Date.parse(appointment.starts_at);
  if (!Number.isFinite(startMs)) return null;

  const travelMinutes = boundedMinutes(
    appointment.travel_minutes,
    preferences.default_travel_min,
    1,
    720,
  );
  const bufferMinutes = boundedMinutes(preferences.travel_buffer_min, 10, 0, 120);
  const preparationMinutes = boundedMinutes(
    appointment.preparation_minutes,
    preferences.default_prep_min,
    0,
    240,
  );
  const leaveAtMs = startMs - (travelMinutes + bufferMinutes) * 60000;
  const prepareAtMs = leaveAtMs - preparationMinutes * 60000;
  const status =
    nowMs >= startMs
      ? "started"
      : nowMs >= leaveAtMs
        ? "leave_now"
        : nowMs >= prepareAtMs
          ? "prepare"
          : "upcoming";

  return {
    appointmentId: appointment.id,
    title: appointment.title,
    startsAt: new Date(startMs).toISOString(),
    location: appointment.location!.trim(),
    mode: preferences.travel_mode,
    travelMinutes,
    bufferMinutes,
    preparationMinutes,
    leaveAt: new Date(leaveAtMs).toISOString(),
    prepareAt: new Date(prepareAtMs).toISOString(),
    minutesUntilLeave: Math.ceil((leaveAtMs - nowMs) / 60000),
    status,
  };
}

export function travelModeLabel(mode: TravelMode) {
  switch (mode) {
    case "driving":
      return "Drive";
    case "transit":
      return "Public transit";
    case "walking":
      return "Walk";
    case "cycling":
      return "Cycle";
    default:
      return "Travel";
  }
}
