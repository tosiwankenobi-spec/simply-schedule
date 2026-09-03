import { describe, expect, test } from "bun:test";
import {
  buildDayReplan,
  type ReplanAppointment,
  type ReplanBusyInterval,
} from "../src/lib/replan-day";
import type { Prefs, TaskRow } from "../src/lib/tasks.server";

const prefs: Prefs = {
  id: "profile",
  name: "Workday",
  work_start: "09:00",
  work_end: "18:00",
  default_meeting_min: 30,
  break_every_min: 90,
  break_length_min: 10,
  lunch_at: "12:30",
  lunch_length_min: 0,
  notes: null,
};

function task(id: string, appointmentId: string): TaskRow {
  return {
    id,
    title: "Prepare report",
    notes: null,
    estimated_min: 60,
    priority: 1,
    energy: "deep",
    deadline: "2026-09-04",
    status: "scheduled",
    scheduled_appointment_id: appointmentId,
    created_at: "2026-09-01T00:00:00.000Z",
  };
}

function taskBlock(id: string, startsAt: string, endsAt: string): ReplanAppointment {
  return {
    id,
    title: "Prepare report",
    starts_at: startsAt,
    ends_at: endsAt,
    source: "task",
  };
}

function protectedBlock(
  id: string,
  title: string,
  startsAt: string,
  endsAt: string,
): ReplanBusyInterval {
  return {
    id,
    title,
    start: Date.parse(startsAt),
    end: Date.parse(endsAt),
  };
}

describe("automatic day replanning", () => {
  test("moves a flexible task around a shared household commitment", () => {
    const appointment = taskBlock(
      "task-block",
      "2026-09-04T11:00:00.000Z",
      "2026-09-04T12:00:00.000Z",
    );
    const result = buildDayReplan({
      date: "2026-09-04",
      nowMs: Date.parse("2026-09-04T10:00:00.000Z"),
      timezoneOffsetMinutes: 0,
      prefs,
      tasks: [task("task", appointment.id)],
      appointments: [appointment],
      protectedBusy: [
        protectedBlock(
          "shared-event",
          "School pickup",
          "2026-09-04T11:00:00.000Z",
          "2026-09-04T12:00:00.000Z",
        ),
      ],
    });

    expect(result.moves[0]).toMatchObject({
      appointmentId: appointment.id,
      toStart: "2026-09-04T12:00:00.000Z",
      conflictsWith: "School pickup",
      reason: "conflict",
    });
    expect(result.fixedCount).toBe(1);
  });

  test("keeps a replanned task out of protected travel and preparation time", () => {
    const appointment = taskBlock(
      "task-block",
      "2026-09-04T10:45:00.000Z",
      "2026-09-04T11:45:00.000Z",
    );
    const result = buildDayReplan({
      date: "2026-09-04",
      nowMs: Date.parse("2026-09-04T10:00:00.000Z"),
      timezoneOffsetMinutes: 0,
      prefs,
      tasks: [task("task", appointment.id)],
      appointments: [appointment],
      protectedBusy: [
        protectedBlock(
          "dentist",
          "Dentist",
          "2026-09-04T10:30:00.000Z",
          "2026-09-04T12:00:00.000Z",
        ),
      ],
    });

    expect(result.moves[0]).toMatchObject({
      toStart: "2026-09-04T12:00:00.000Z",
      conflictsWith: "Dentist",
    });
  });

  test("never proposes moving a fixed appointment", () => {
    const fixed: ReplanAppointment = {
      id: "fixed",
      title: "Client meeting",
      starts_at: "2026-09-04T09:00:00.000Z",
      ends_at: "2026-09-04T10:00:00.000Z",
      source: "manual",
    };
    const result = buildDayReplan({
      date: "2026-09-04",
      nowMs: Date.parse("2026-09-04T11:00:00.000Z"),
      timezoneOffsetMinutes: 0,
      prefs,
      tasks: [],
      appointments: [fixed],
      protectedBusy: [
        protectedBlock(fixed.id, fixed.title, fixed.starts_at, fixed.ends_at as string),
      ],
    });

    expect(result.moves).toEqual([]);
    expect(result.affectedCount).toBe(0);
    expect(result.fixedCount).toBe(1);
  });
});
