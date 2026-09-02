import type { TaskRow } from "./tasks.server";

export type WeeklyResetTask = TaskRow & { updated_at: string };

export type WeeklyResetAppointment = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  source: string;
  commitment_type: string;
  is_all_day: boolean;
};

export type ReviewTask = {
  id: string;
  title: string;
  detail: string;
};

export function addDateDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

export function wallClockMs(date: string, time: string, tzOffsetMin: number) {
  return Date.parse(`${date}T${time}:00Z`) + tzOffsetMin * 60000;
}

function appointmentEnd(appointment: WeeklyResetAppointment) {
  const start = Date.parse(appointment.starts_at);
  const explicitEnd = appointment.ends_at ? Date.parse(appointment.ends_at) : Number.NaN;
  return Number.isFinite(explicitEnd) ? explicitEnd : start + 30 * 60000;
}

export function buildWeeklyReview(input: {
  tasks: WeeklyResetTask[];
  appointments: WeeklyResetAppointment[];
  reviewStartMs: number;
  weekStartMs: number;
  nowMs: number;
}) {
  const appointmentById = new Map(
    input.appointments.map((appointment) => [appointment.id, appointment]),
  );
  const completed: ReviewTask[] = [];
  const slipped: ReviewTask[] = [];
  const eligible: WeeklyResetTask[] = [];

  for (const task of input.tasks) {
    const updated = Date.parse(task.updated_at);
    if (
      task.status === "done" &&
      Number.isFinite(updated) &&
      updated >= input.reviewStartMs &&
      updated < input.weekStartMs
    ) {
      completed.push({ id: task.id, title: task.title, detail: "Completed this week" });
      continue;
    }
    if (task.status === "done") continue;

    const linked = task.scheduled_appointment_id
      ? appointmentById.get(task.scheduled_appointment_id)
      : undefined;
    const deadlineMs = task.deadline ? Date.parse(`${task.deadline}T23:59:59Z`) : Number.NaN;
    const overdue = Number.isFinite(deadlineMs) && deadlineMs < input.weekStartMs;
    const missedBlock = Boolean(
      linked &&
      Date.parse(linked.starts_at) >= input.reviewStartMs &&
      appointmentEnd(linked) < input.nowMs,
    );

    if (overdue || missedBlock) {
      slipped.push({
        id: task.id,
        title: task.title,
        detail: overdue ? `Deadline ${task.deadline}` : "Scheduled block has passed",
      });
    }
    if (task.status === "open" || missedBlock) eligible.push(task);
  }

  return { completed, slipped, eligible };
}

export function overlaps(
  candidate: { starts_at: string; ends_at: string },
  existing: { starts_at: string; ends_at: string | null },
) {
  const candidateStart = Date.parse(candidate.starts_at);
  const candidateEnd = Date.parse(candidate.ends_at);
  const existingStart = Date.parse(existing.starts_at);
  const parsedEnd = existing.ends_at ? Date.parse(existing.ends_at) : Number.NaN;
  const existingEnd = Number.isFinite(parsedEnd) ? parsedEnd : existingStart + 30 * 60000;
  return candidateStart < existingEnd && candidateEnd > existingStart;
}
