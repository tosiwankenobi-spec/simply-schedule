export type NowTask = {
  id: string;
  title: string;
  estimated_min: number;
  priority: number;
  deadline: string | null;
};

export type NowAppointment = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
};

type RecommendationBase = {
  generatedAt: string;
  availableMinutes: number;
};

export type NowRecommendation =
  | (RecommendationBase & {
      kind: "task";
      taskId: string;
      title: string;
      estimatedMinutes: number;
      reason: string;
      nextCommitment: string | null;
    })
  | (RecommendationBase & {
      kind: "appointment";
      appointmentId: string;
      title: string;
      startsAt: string;
      location: string | null;
      reason: string;
    })
  | (RecommendationBase & {
      kind: "clear";
      title: string;
      reason: string;
    });

const MINUTE = 60_000;
const DEFAULT_OPEN_WINDOW_MIN = 120;

function appointmentEnd(appointment: NowAppointment) {
  const start = Date.parse(appointment.starts_at);
  const explicitEnd = appointment.ends_at ? Date.parse(appointment.ends_at) : Number.NaN;
  return Number.isFinite(explicitEnd) ? explicitEnd : start + 30 * MINUTE;
}

function isOnlineLocation(location: string | null) {
  if (!location) return false;
  return /(?:https?:\/\/|zoom|meet\.google|teams\.microsoft|online|virtual)/i.test(location);
}

function preparationMinutes(location: string | null) {
  if (!location) return 10;
  return isOnlineLocation(location) ? 5 : 20;
}

function localDateKey(now: Date, timezoneOffsetMinutes: number) {
  return new Date(now.getTime() - timezoneOffsetMinutes * MINUTE).toISOString().slice(0, 10);
}

function deadlineDistance(deadline: string | null, today: string) {
  if (!deadline) return Number.POSITIVE_INFINITY;
  const deadlineDay = Date.parse(`${deadline.slice(0, 10)}T00:00:00Z`);
  const todayDay = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(deadlineDay) || !Number.isFinite(todayDay)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.round((deadlineDay - todayDay) / (24 * 60 * MINUTE));
}

function taskScore(task: NowTask, availableMinutes: number, today: string) {
  const daysUntilDeadline = deadlineDistance(task.deadline, today);
  const urgency =
    daysUntilDeadline < 0
      ? 700
      : daysUntilDeadline === 0
        ? 550
        : daysUntilDeadline === 1
          ? 400
          : daysUntilDeadline <= 7
            ? 220 - daysUntilDeadline * 10
            : 0;
  const priority = Math.max(0, 4 - task.priority) * 140;
  const fit = Math.max(0, 180 - Math.abs(availableMinutes - task.estimated_min));
  return urgency + priority + fit;
}

function taskReason(task: NowTask, availableMinutes: number, today: string) {
  const daysUntilDeadline = deadlineDistance(task.deadline, today);
  if (daysUntilDeadline < 0)
    return `It is overdue and fits your ${availableMinutes}-minute window.`;
  if (daysUntilDeadline === 0) return `It is due today and fits before your next commitment.`;
  if (daysUntilDeadline === 1) return `It is due tomorrow and fits your current window.`;
  if (task.priority === 1)
    return `It is high priority and fits your ${availableMinutes}-minute window.`;
  return `It is the strongest fit for the time you have available.`;
}

export function buildNowRecommendation({
  now,
  timezoneOffsetMinutes,
  tasks,
  appointments,
}: {
  now: Date;
  timezoneOffsetMinutes: number;
  tasks: NowTask[];
  appointments: NowAppointment[];
}): NowRecommendation {
  const nowMs = now.getTime();
  const generatedAt = now.toISOString();
  const timedAppointments = appointments
    .filter((appointment) => Number.isFinite(Date.parse(appointment.starts_at)))
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));

  const active = timedAppointments.find(
    (appointment) =>
      Date.parse(appointment.starts_at) <= nowMs && appointmentEnd(appointment) > nowMs,
  );
  if (active) {
    return {
      kind: "appointment",
      appointmentId: active.id,
      title: active.title,
      startsAt: active.starts_at,
      location: active.location,
      generatedAt,
      availableMinutes: 0,
      reason: "This commitment is happening now.",
    };
  }

  const next =
    timedAppointments.find((appointment) => Date.parse(appointment.starts_at) > nowMs) ?? null;
  if (next) {
    const minutesUntilStart = Math.max(
      0,
      Math.floor((Date.parse(next.starts_at) - nowMs) / MINUTE),
    );
    const prepMinutes = preparationMinutes(next.location);
    if (minutesUntilStart <= prepMinutes) {
      return {
        kind: "appointment",
        appointmentId: next.id,
        title: next.title,
        startsAt: next.starts_at,
        location: next.location,
        generatedAt,
        availableMinutes: 0,
        reason:
          next.location && !isOnlineLocation(next.location)
            ? "Leave or get ready now so you arrive without rushing."
            : "Get ready now; this starts soon.",
      };
    }
  }

  const availableMinutes = next
    ? Math.max(
        0,
        Math.floor((Date.parse(next.starts_at) - nowMs) / MINUTE) -
          preparationMinutes(next.location),
      )
    : DEFAULT_OPEN_WINDOW_MIN;
  const today = localDateKey(now, timezoneOffsetMinutes);
  const fittingTasks = tasks.filter(
    (task) => task.estimated_min > 0 && task.estimated_min <= availableMinutes,
  );
  const bestTask = fittingTasks.sort(
    (a, b) => taskScore(b, availableMinutes, today) - taskScore(a, availableMinutes, today),
  )[0];

  if (bestTask) {
    return {
      kind: "task",
      taskId: bestTask.id,
      title: bestTask.title,
      estimatedMinutes: bestTask.estimated_min,
      reason: taskReason(bestTask, availableMinutes, today),
      nextCommitment: next?.title ?? null,
      generatedAt,
      availableMinutes,
    };
  }

  return {
    kind: "clear",
    title: availableMinutes >= 30 ? "Use this as recovery time" : "Take a short reset",
    reason:
      tasks.length === 0
        ? "You have no unscheduled tasks competing for this window."
        : `None of your open tasks safely fit in the ${availableMinutes} minutes available.`,
    generatedAt,
    availableMinutes,
  };
}
