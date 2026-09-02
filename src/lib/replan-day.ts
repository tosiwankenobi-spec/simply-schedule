import { computeGaps, rankTasks, type Prefs, type TaskRow } from "./tasks.server";

const MINUTE = 60_000;

export type ReplanAppointment = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  source: string;
};

export type ReplanMove = {
  appointmentId: string;
  taskId: string;
  title: string;
  fromStart: string;
  fromEnd: string;
  toStart: string;
  toEnd: string;
  reason: "missed" | "conflict";
  conflictsWith: string | null;
};

export type ReplanPreview = {
  date: string;
  profile: string;
  affectedCount: number;
  unchangedCount: number;
  fixedCount: number;
  moves: ReplanMove[];
  unresolved: {
    appointmentId: string;
    taskId: string;
    title: string;
    reason: "missed" | "conflict";
    conflictsWith: string | null;
    explanation: string;
  }[];
};

export function localTimeMs(date: string, hhmm: string, timezoneOffsetMinutes: number) {
  const [hours = 0, minutes = 0] = hhmm.split(":").map(Number);
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day, hours, minutes) + timezoneOffsetMinutes * MINUTE;
}

function endMs(appointment: ReplanAppointment, fallbackMinutes = 30) {
  const start = Date.parse(appointment.starts_at);
  const end = appointment.ends_at ? Date.parse(appointment.ends_at) : Number.NaN;
  return Number.isFinite(end) ? end : start + fallbackMinutes * MINUTE;
}

function overlaps(start: number, end: number, otherStart: number, otherEnd: number) {
  return start < otherEnd && end > otherStart;
}

export function buildDayReplan({
  date,
  nowMs,
  timezoneOffsetMinutes,
  prefs,
  tasks,
  appointments,
}: {
  date: string;
  nowMs: number;
  timezoneOffsetMinutes: number;
  prefs: Prefs;
  tasks: TaskRow[];
  appointments: ReplanAppointment[];
}): ReplanPreview {
  const tasksByAppointment = new Map(
    tasks
      .filter((task) => task.scheduled_appointment_id)
      .map((task) => [task.scheduled_appointment_id as string, task]),
  );
  const flexible = appointments.flatMap((appointment) => {
    const task = tasksByAppointment.get(appointment.id);
    return task && appointment.source === "task" ? [{ appointment, task }] : [];
  });
  const flexibleIds = new Set(flexible.map(({ appointment }) => appointment.id));
  const fixed = appointments.filter((appointment) => !flexibleIds.has(appointment.id));

  const affected = flexible.flatMap(({ appointment, task }) => {
    const start = Date.parse(appointment.starts_at);
    const end = endMs(appointment, task.estimated_min);
    const conflict = fixed.find((item) => {
      const fixedStart = Date.parse(item.starts_at);
      return overlaps(start, end, fixedStart, endMs(item));
    });
    const reason: "missed" | "conflict" | null =
      end <= nowMs ? "missed" : conflict ? "conflict" : null;
    return reason ? [{ appointment, task, reason, conflict: conflict ?? null }] : [];
  });
  const affectedIds = new Set(affected.map(({ appointment }) => appointment.id));
  const unchanged = flexible.filter(({ appointment }) => !affectedIds.has(appointment.id));
  const busy = [...fixed, ...unchanged.map(({ appointment }) => appointment)].map(
    (appointment) => ({
      start: Date.parse(appointment.starts_at),
      end: endMs(appointment),
    }),
  );
  const planningNow = Math.ceil((nowMs + MINUTE) / (5 * MINUTE)) * 5 * MINUTE;

  const affectedTasks: TaskRow[] = affected.map(({ appointment, task }) => ({
    ...task,
    title: appointment.title || task.title,
    estimated_min: Math.max(
      10,
      Math.round(
        (endMs(appointment, task.estimated_min) - Date.parse(appointment.starts_at)) / MINUTE,
      ),
    ),
  }));
  const moves: ReplanMove[] = [];
  const unresolved: ReplanPreview["unresolved"] = [];
  const affectedByTask = new Map(affected.map((item) => [item.task.id, item]));
  const occupied = [...busy];
  for (const task of rankTasks(affectedTasks)) {
    const item = affectedByTask.get(task.id);
    if (!item) continue;
    const duration = task.estimated_min * MINUTE;
    const currentGaps = computeGaps(date, prefs, occupied, planningNow, timezoneOffsetMinutes);
    const originalStart = Date.parse(item.appointment.starts_at);
    const preferredStart =
      item.reason === "conflict" ? Math.max(originalStart, planningNow) : planningNow;
    const laterSlot = currentGaps
      .map((gap) => ({ start: Math.max(gap.start, preferredStart), end: gap.end }))
      .find((gap) => gap.end - gap.start >= duration);
    const fallbackSlot = laterSlot
      ? null
      : currentGaps
          .filter((gap) => gap.end - gap.start >= duration)
          .map((gap) => ({ start: gap.start, distance: Math.abs(gap.start - originalStart) }))
          .sort((a, b) => a.distance - b.distance)[0];
    const toStart = laterSlot?.start ?? fallbackSlot?.start ?? null;
    const fromEnd = new Date(endMs(item.appointment, item.task.estimated_min)).toISOString();
    if (toStart !== null) {
      const toEnd = toStart + duration;
      moves.push({
        appointmentId: item.appointment.id,
        taskId: item.task.id,
        title: item.appointment.title,
        fromStart: new Date(item.appointment.starts_at).toISOString(),
        fromEnd,
        toStart: new Date(toStart).toISOString(),
        toEnd: new Date(toEnd).toISOString(),
        reason: item.reason,
        conflictsWith: item.conflict?.title ?? null,
      });
      occupied.push({ start: toStart, end: toEnd + prefs.break_length_min * MINUTE });
    } else {
      unresolved.push({
        appointmentId: item.appointment.id,
        taskId: item.task.id,
        title: item.appointment.title,
        reason: item.reason,
        conflictsWith: item.conflict?.title ?? null,
        explanation: "No safe opening remains inside today's working hours.",
      });
    }
  }

  return {
    date,
    profile: prefs.name,
    affectedCount: affected.length,
    unchangedCount: unchanged.length,
    fixedCount: fixed.length,
    moves,
    unresolved,
  };
}

export function intervalsOverlap(
  first: { start: number; end: number },
  second: { start: number; end: number },
) {
  return overlaps(first.start, first.end, second.start, second.end);
}
