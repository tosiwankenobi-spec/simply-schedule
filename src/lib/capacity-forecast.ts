/**
 * Deterministic deadline + capacity forecasting.
 *
 * Pure, client-safe math: no database, no AI, no clock of its own (every entry
 * point takes `nowMs`). The server function in `capacity-forecast.functions.ts`
 * gathers the RLS-filtered inputs; everything below only reasons about them.
 *
 * Allocation rules (documented so the UI can explain itself):
 *  1. Free time is shared: each minute of a gap is allocated at most once.
 *  2. Order is earliest deadline first, then priority (1 = highest), then the
 *     oldest task, then id — fully deterministic.
 *  3. A task must fit one contiguous remaining gap, exactly like the planner.
 *  4. A placed block reserves the profile's break afterwards, like the planner.
 *  5. Work already sitting in a live future block is not re-allocated; its
 *     calendar block is already busy time.
 */

export const FORECAST_HORIZON_DAYS = 14;
/** Under this much room to spare before a deadline, the plan is called "tight". */
export const TIGHT_SLACK_MINUTES = 60;
/** …or when spare time is under this share of the work itself. */
export const TIGHT_SLACK_RATIO = 0.25;
/** A day with less than this left is treated as full. */
export const FULL_DAY_MINUTES = 10;

export type ForecastTask = {
  id: string;
  title: string;
  estimatedMin: number;
  priority: number;
  deadline: string | null;
  status: string;
  createdAt: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
};

export type ForecastGap = { start: number; end: number };

export type ForecastDayInput = {
  date: string;
  offsetMinutes: number;
  /** Absolute ms windows of free working time, already free of busy/lunch/travel. */
  gaps: ForecastGap[];
  breakMinutes: number;
  workingMinutes: number;
  /** Working minutes consumed by appointments, travel protection and lunch. */
  committedMinutes: number;
  profileName: string;
};

export type ForecastDay = {
  date: string;
  workingMinutes: number;
  committedMinutes: number;
  capacityMinutes: number;
  allocatedMinutes: number;
  freeMinutes: number;
  largestGapMinutes: number;
  isFull: boolean;
  profileName: string;
};

export type ForecastStatus = "critical" | "tight" | "on-track";

export type ForecastDeadline = {
  taskId: string;
  title: string;
  deadline: string;
  estimatedMin: number;
  priority: number;
  status: ForecastStatus;
  /** Spare capacity left before the deadline once this task is fitted. */
  slackMinutes: number;
  /** Minutes still needing free time — 0 when a live on-time block holds it. */
  outstandingMinutes: number;
  /** True when a live block on or before the deadline already holds this work. */
  alreadyBooked: boolean;
  /** Minutes of this task that could not be fitted before the deadline. */
  shortfallMinutes: number;
  plannedDate: string | null;
  reasons: string[];
};

export type ForecastBacklogItem = {
  taskId: string;
  title: string;
  estimatedMin: number;
  priority: number;
  plannedDate: string | null;
};

export type CapacityForecast = {
  generatedAt: string;
  timeZone: string;
  fromDate: string;
  toDate: string;
  days: ForecastDay[];
  totalCapacityMinutes: number;
  totalFreeMinutes: number;
  requiredMinutes: number;
  deadlineRequiredMinutes: number;
  headline: string;
  firstOverloadedDate: string | null;
  counts: { critical: number; tight: number; onTrack: number; backlog: number };
  deadlines: ForecastDeadline[];
  backlog: ForecastBacklogItem[];
};

/* ------------------------------------------------------------------ */
/* Timezone helpers — local dates and per-day offsets across DST.       */
/* ------------------------------------------------------------------ */

export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string" || timeZone.trim().length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimeZone(timeZone: unknown, fallback = "UTC"): string {
  return isValidTimeZone(timeZone) ? timeZone : fallback;
}

const partsFormatter = (timeZone: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

function zonedParts(timeZone: string, utcMs: number) {
  const parts = partsFormatter(timeZone).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Same sign convention as `Date#getTimezoneOffset()`: minutes UTC is ahead of local. */
export function zoneOffsetMinutes(timeZone: string, utcMs: number): number {
  const p = zonedParts(timeZone, utcMs);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((utcMs - asUtc) / 60000);
}

export function localDateString(timeZone: string, utcMs: number): string {
  const p = zonedParts(timeZone, utcMs);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function addDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Exact UTC instant for a local wall-clock time in an IANA zone. Two passes so
 * the offset used is the one actually in force at that instant, not at some
 * other hour of the same day (which differs on DST transition days).
 */
export function zonedInstant(timeZone: string, date: string, hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  const naive = Date.parse(
    `${date}T${String(h ?? 0).padStart(2, "0")}:${String(m ?? 0).padStart(2, "0")}:00Z`,
  );
  let guess = naive + zoneOffsetMinutes(timeZone, naive) * 60000;
  guess = naive + zoneOffsetMinutes(timeZone, guess) * 60000;
  return guess;
}

/**
 * Local day bounds in an IANA zone. Built from midnight of this day and midnight
 * of the next day, so a spring-forward day is 23h and a fall-back day is 25h.
 */
export function localDayRange(timeZone: string, date: string): { startMs: number; endMs: number } {
  return {
    startMs: zonedInstant(timeZone, date, "00:00"),
    endMs: zonedInstant(timeZone, addDays(date, 1), "00:00"),
  };
}

/** Default length used for an event with a missing or invalid end. */
export const FORECAST_DEFAULT_EVENT_MIN = 30;

export function eventInterval(
  startsAt: string,
  endsAt: string | null | undefined,
  defaultMin = FORECAST_DEFAULT_EVENT_MIN,
): { start: number; end: number } | null {
  const start = Date.parse(startsAt);
  if (!Number.isFinite(start)) return null;
  const parsedEnd = endsAt ? Date.parse(endsAt) : Number.NaN;
  const end =
    Number.isFinite(parsedEnd) && parsedEnd > start
      ? parsedEnd
      : start + Math.max(5, defaultMin) * 60000;
  return { start, end };
}

/** True when an event overlaps [startMs, endMs) — not merely starts inside it. */
export function overlapsRange(
  event: { starts_at: string; ends_at?: string | null },
  startMs: number,
  endMs: number,
  defaultMin = FORECAST_DEFAULT_EVENT_MIN,
): boolean {
  const interval = eventInterval(event.starts_at, event.ends_at ?? null, defaultMin);
  if (!interval) return false;
  return interval.start < endMs && interval.end > startMs;
}

export type ForecastDate = {
  date: string;
  offsetMinutes: number;
  startMs: number;
  endMs: number;
};

/**
 * Local dates across the horizon with exact zone-aware bounds per day, so DST
 * transitions inside the horizon are honoured instead of today's offset being
 * smeared over every day. `offsetMinutes` is the offset at local noon, kept for
 * display and for callers that need a representative offset.
 */
export function forecastDates(
  timeZone: string,
  nowMs: number,
  days = FORECAST_HORIZON_DAYS,
): ForecastDate[] {
  const first = localDateString(timeZone, nowMs);
  const out: ForecastDate[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(first, i);
    const offsetMinutes = zoneOffsetMinutes(timeZone, zonedInstant(timeZone, date, "12:00"));
    const { startMs, endMs } = localDayRange(timeZone, date);
    out.push({ date, offsetMinutes, startMs, endMs });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Planner profile assignment resolution (no per-day round trips).      */
/* ------------------------------------------------------------------ */

export type ProfileAssignment = { profile_id: string; start_date: string; end_date: string };

export function resolveProfileIdForDate(
  assignments: ProfileAssignment[],
  date: string,
): string | null {
  // Assignments arrive newest-first; the first covering window wins, matching
  // the single-day planner's `prefsForDate`.
  const hit = assignments.find((a) => a.start_date <= date && a.end_date >= date);
  return hit ? hit.profile_id : null;
}

/* ------------------------------------------------------------------ */
/* Allocation                                                           */
/* ------------------------------------------------------------------ */

export function rankForecastTasks(tasks: ForecastTask[]): ForecastTask[] {
  return [...tasks].sort((a, b) => {
    const ad = a.deadline ? Date.parse(`${a.deadline}T00:00:00Z`) : Number.POSITIVE_INFINITY;
    const bd = b.deadline ? Date.parse(`${b.deadline}T00:00:00Z`) : Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad - bd;
    if (a.priority !== b.priority) return a.priority - b.priority;
    const ac = Date.parse(a.createdAt);
    const bc = Date.parse(b.createdAt);
    if (ac !== bc) return ac - bc;
    return a.id.localeCompare(b.id);
  });
}

type DayLedger = {
  input: ForecastDayInput;
  /** Remaining minutes per contiguous gap. */
  remaining: number[];
  allocated: number;
};

function minutesLabel(min: number) {
  const rounded = Math.max(0, Math.round(min));
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function formatMinutes(min: number) {
  return minutesLabel(min);
}

export function buildCapacityForecast(params: {
  nowMs: number;
  timeZone: string;
  days: ForecastDayInput[];
  tasks: ForecastTask[];
}): CapacityForecast {
  const { nowMs, timeZone, days, tasks } = params;
  const ledgers: DayLedger[] = days.map((input) => ({
    input,
    remaining: input.gaps.map((g) => Math.max(0, Math.round((g.end - g.start) / 60000))),
    allocated: 0,
  }));
  const dateIndex = new Map(days.map((d, i) => [d.date, i]));
  const lastDate = days.length > 0 ? days[days.length - 1]!.date : localDateString(timeZone, nowMs);
  const firstDate = days.length > 0 ? days[0]!.date : lastDate;

  // Only work that matters to this horizon: overdue and in-horizon deadlines,
  // plus undated work. A deadline beyond `lastDate` is a later horizon's problem
  // and must not consume this horizon's capacity or appear as a risk here.
  const inHorizon = tasks.filter(
    (t) => t.status !== "done" && (!t.deadline || t.deadline <= lastDate),
  );
  const ranked = rankForecastTasks(inHorizon);

  const deadlines: ForecastDeadline[] = [];
  const backlog: ForecastBacklogItem[] = [];

  for (const task of ranked) {
    const need = Math.max(10, Math.round(task.estimatedMin || 30));
    const reasons: string[] = [];
    let critical = false;

    const scheduledStartMs = task.scheduledStart ? Date.parse(task.scheduledStart) : Number.NaN;
    const scheduledEndMs = task.scheduledEnd ? Date.parse(task.scheduledEnd) : Number.NaN;
    const hasLiveBlock = Number.isFinite(scheduledEndMs) && scheduledEndMs > nowMs;
    const missedBlock = Number.isFinite(scheduledEndMs) && scheduledEndMs <= nowMs;

    if (task.deadline && task.deadline < firstDate) {
      critical = true;
      reasons.push(`Deadline passed on ${task.deadline}.`);
    }
    if (missedBlock) {
      critical = true;
      reasons.push("Its booked block has already passed and the work is not marked done.");
    }
    let bookedAfterDeadline = false;
    if (task.deadline && Number.isFinite(scheduledStartMs)) {
      const blockDate = localDateString(timeZone, scheduledStartMs);
      if (blockDate > task.deadline) {
        critical = true;
        bookedAfterDeadline = true;
        reasons.push(`Its booked block on ${blockDate} lands after the deadline.`);
      }
    }

    /**
     * Work sitting in a live block that lands on or before its deadline is
     * already satisfied: its minutes are busy time on the calendar, so counting
     * them again as outstanding demand would invent an overload.
     */
    const satisfiedByBlock = hasLiveBlock && !bookedAfterDeadline;
    const outstandingMinutes = satisfiedByBlock ? 0 : need;

    // Work already held in a live future block keeps that block; only work that
    // still needs time competes for the shared free capacity.
    let plannedDate: string | null = null;
    let placed = hasLiveBlock;
    if (hasLiveBlock) {
      plannedDate = localDateString(timeZone, scheduledStartMs);
      reasons.push(`Already booked for ${plannedDate}.`);
    } else {
      for (const ledger of ledgers) {
        const gapIdx = ledger.remaining.findIndex((room) => room >= need);
        if (gapIdx === -1) continue;
        ledger.remaining[gapIdx] = Math.max(
          0,
          ledger.remaining[gapIdx]! - need - ledger.input.breakMinutes,
        );
        ledger.allocated += need;
        plannedDate = ledger.input.date;
        placed = true;
        break;
      }
    }

    if (!task.deadline) {
      backlog.push({
        taskId: task.id,
        title: task.title,
        estimatedMin: need,
        priority: task.priority,
        plannedDate,
      });
      continue;
    }

    const dueIdx = dateIndex.has(task.deadline)
      ? dateIndex.get(task.deadline)!
      : task.deadline < firstDate
        ? -1
        : days.length - 1;

    const slackMinutes =
      dueIdx < 0
        ? 0
        : ledgers
            .slice(0, dueIdx + 1)
            .reduce((sum, l) => sum + l.remaining.reduce((s, r) => s + r, 0), 0);

    let shortfallMinutes = 0;
    if (!placed) {
      shortfallMinutes = need;
      critical = true;
      const largest = Math.max(0, ...ledgers.flatMap((l) => l.remaining));
      reasons.push(
        largest <= 0
          ? `No free working time left in the next ${days.length} days.`
          : `Needs ${minutesLabel(need)} in one sitting — the largest free window left is ${minutesLabel(largest)}.`,
      );
    } else if (bookedAfterDeadline) {
      shortfallMinutes = need;
    } else if (!hasLiveBlock && plannedDate && plannedDate > task.deadline) {
      shortfallMinutes = need;
      critical = true;
      reasons.push(`The earliest free time for it is ${plannedDate}, after the deadline.`);
    } else if (dueIdx < 0) {
      shortfallMinutes = need;
    }

    let status: ForecastStatus = "on-track";
    if (critical) status = "critical";
    else if (satisfiedByBlock) {
      // The time is already reserved on the calendar on or before the deadline,
      // so remaining free capacity says nothing about whether it will be done.
      status = "on-track";
    } else if (slackMinutes < TIGHT_SLACK_MINUTES || slackMinutes < need * TIGHT_SLACK_RATIO) {
      status = "tight";
      reasons.push(`Only ${minutesLabel(slackMinutes)} spare before the deadline.`);
    } else {
      reasons.push(`${minutesLabel(slackMinutes)} spare before the deadline.`);
    }

    deadlines.push({
      taskId: task.id,
      title: task.title,
      deadline: task.deadline,
      estimatedMin: need,
      outstandingMinutes,
      alreadyBooked: satisfiedByBlock,
      priority: task.priority,
      status,
      slackMinutes,
      shortfallMinutes,
      plannedDate,
      reasons,
    });
  }

  const forecastDays: ForecastDay[] = ledgers.map((ledger) => {
    const capacityMinutes = ledger.input.gaps.reduce(
      (sum, g) => sum + Math.max(0, Math.round((g.end - g.start) / 60000)),
      0,
    );
    const freeMinutes = ledger.remaining.reduce((s, r) => s + r, 0);
    return {
      date: ledger.input.date,
      workingMinutes: ledger.input.workingMinutes,
      committedMinutes: ledger.input.committedMinutes,
      capacityMinutes,
      allocatedMinutes: ledger.allocated,
      freeMinutes,
      largestGapMinutes: Math.max(0, ...ledger.remaining, 0),
      isFull: freeMinutes < FULL_DAY_MINUTES,
      profileName: ledger.input.profileName,
    };
  });

  /**
   * Earliest day the plan stops working. Derived from actual allocation
   * outcomes: a deadline that could not be fitted (capacity or contiguous-gap
   * failure) overloads its own due date, and otherwise cumulative *outstanding*
   * demand — protected on-time blocks excluded, since their minutes are already
   * reserved inside the busy calendar — is compared with cumulative capacity.
   */
  let firstOverloadedDate: string | null = null;
  let cumulativeCapacity = 0;
  for (const day of forecastDays) {
    cumulativeCapacity += day.capacityMinutes;
    const due = deadlines.filter((d) => d.deadline <= day.date);
    const outstandingByThen = due.reduce((sum, d) => sum + d.outstandingMinutes, 0);
    const anyShortfall = due.some((d) => d.shortfallMinutes > 0);
    if (anyShortfall || outstandingByThen > cumulativeCapacity) {
      firstOverloadedDate = day.date;
      break;
    }
  }

  const totalCapacityMinutes = forecastDays.reduce((s, d) => s + d.capacityMinutes, 0);
  const totalFreeMinutes = forecastDays.reduce((s, d) => s + d.freeMinutes, 0);
  // Required = work still needing time. On-time booked blocks are excluded so
  // the summary never reports reserved work as outstanding demand.
  const deadlineRequiredMinutes = deadlines.reduce((s, d) => s + d.outstandingMinutes, 0);
  const requiredMinutes = deadlineRequiredMinutes + backlog.reduce((s, b) => s + b.estimatedMin, 0);

  const counts = {
    critical: deadlines.filter((d) => d.status === "critical").length,
    tight: deadlines.filter((d) => d.status === "tight").length,
    onTrack: deadlines.filter((d) => d.status === "on-track").length,
    backlog: backlog.length,
  };

  const ordered = [...deadlines].sort(
    (a, b) =>
      a.deadline.localeCompare(b.deadline) ||
      a.priority - b.priority ||
      a.title.localeCompare(b.title) ||
      a.taskId.localeCompare(b.taskId),
  );

  return {
    generatedAt: new Date(nowMs).toISOString(),
    timeZone,
    fromDate: firstDate,
    toDate: lastDate,
    days: forecastDays,
    totalCapacityMinutes,
    totalFreeMinutes,
    requiredMinutes,
    deadlineRequiredMinutes,
    headline: buildHeadline({
      counts,
      days: days.length,
      totalCapacityMinutes,
      deadlineRequiredMinutes,
    }),
    firstOverloadedDate,
    counts,
    deadlines: ordered,
    backlog,
  };
}

function buildHeadline(input: {
  counts: { critical: number; tight: number; onTrack: number; backlog: number };
  days: number;
  totalCapacityMinutes: number;
  deadlineRequiredMinutes: number;
}) {
  const { counts, days, totalCapacityMinutes, deadlineRequiredMinutes } = input;
  if (counts.critical > 0) {
    return `${counts.critical} deadline${counts.critical === 1 ? "" : "s"} won't be met without a change of plan.`;
  }
  if (counts.tight > 0) {
    return `${counts.tight} deadline${counts.tight === 1 ? "" : "s"} ${counts.tight === 1 ? "is" : "are"} tight — there is little room to spare.`;
  }
  if (counts.onTrack === 0 && counts.backlog === 0) {
    return `Nothing is due in the next ${days} days.`;
  }
  if (counts.onTrack === 0) {
    return `No deadlines ahead — ${counts.backlog} item${counts.backlog === 1 ? "" : "s"} waiting whenever you have time.`;
  }
  return `Every deadline in the next ${days} days fits, with ${minutesLabel(totalCapacityMinutes - deadlineRequiredMinutes)} to spare.`;
}
