// Server-only helpers for the task backlog + auto-scheduling engine.

export type TaskRow = {
  id: string;
  title: string;
  notes: string | null;
  estimated_min: number;
  priority: number;
  energy: string;
  deadline: string | null;
  status: string;
  scheduled_appointment_id: string | null;
  created_at: string;
};

export type Placement = {
  task_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  estimated_min: number;
};

export type Prefs = {
  id: string;
  name: string;
  work_start: string;
  work_end: string;
  default_meeting_min: number;
  break_every_min: number;
  break_length_min: number;
  lunch_at: string;
  lunch_length_min: number;
  notes: string | null;
};

const PROFILE_COLS =
  "id,name,is_default,work_start,work_end,default_meeting_min,break_every_min,break_length_min,lunch_at,lunch_length_min,notes";

const FALLBACK: Prefs = {
  id: "",
  name: "Default",
  work_start: "09:00",
  work_end: "18:00",
  default_meeting_min: 30,
  break_every_min: 90,
  break_length_min: 10,
  lunch_at: "12:30",
  lunch_length_min: 45,
  notes: null,
};

export async function prefsForDate(supabase: any, userId: string, date: string): Promise<Prefs> {
  const { data: assigns } = await supabase
    .from("planner_profile_assignments")
    .select("profile_id")
    .eq("user_id", userId)
    .lte("start_date", date)
    .gte("end_date", date)
    .order("created_at", { ascending: false })
    .limit(1);
  const assigned = (assigns ?? [])[0];
  if (assigned) {
    const { data: prof } = await supabase
      .from("planner_profiles")
      .select(PROFILE_COLS)
      .eq("user_id", userId)
      .eq("id", assigned.profile_id)
      .maybeSingle();
    if (prof) return prof as Prefs;
  }
  const { data: def } = await supabase
    .from("planner_profiles")
    .select(PROFILE_COLS)
    .eq("user_id", userId)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (def as Prefs) ?? FALLBACK;
}

function atTime(date: string, hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(`${date}T00:00:00`);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d.getTime();
}

type Busy = { start: number; end: number };

export function computeGaps(date: string, prefs: Prefs, busy: Busy[], nowMs: number): Busy[] {
  const dayStart = Math.max(atTime(date, prefs.work_start), nowMs);
  const dayEnd = atTime(date, prefs.work_end);
  if (dayEnd <= dayStart) return [];

  const blocks: Busy[] = [...busy];
  if (prefs.lunch_length_min > 0) {
    const ls = atTime(date, prefs.lunch_at);
    blocks.push({ start: ls, end: ls + prefs.lunch_length_min * 60000 });
  }

  const merged: Busy[] = [];
  for (const b of blocks.sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
    else merged.push({ ...b });
  }

  const gaps: Busy[] = [];
  let cursor = dayStart;
  for (const b of merged) {
    if (b.end <= cursor) continue;
    if (b.start > cursor) gaps.push({ start: cursor, end: Math.min(b.start, dayEnd) });
    cursor = Math.max(cursor, b.end);
    if (cursor >= dayEnd) break;
  }
  if (cursor < dayEnd) gaps.push({ start: cursor, end: dayEnd });
  return gaps.filter((g) => g.end - g.start >= 10 * 60000);
}

export function rankTasks(tasks: TaskRow[]): TaskRow[] {
  return [...tasks].sort((a, b) => {
    const ad = a.deadline ? Date.parse(a.deadline) : Number.POSITIVE_INFINITY;
    const bd = b.deadline ? Date.parse(b.deadline) : Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad - bd;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return Date.parse(a.created_at) - Date.parse(b.created_at);
  });
}

/** Greedy fit of ranked tasks into free gaps, inserting short breaks between blocks. */
export function fitTasks(
  tasks: TaskRow[],
  gaps: Busy[],
  prefs: Prefs,
): { placements: Placement[]; unplaced: TaskRow[] } {
  const placements: Placement[] = [];
  const unplaced: TaskRow[] = [];
  const cursors = gaps.map((g) => g.start);
  const breakMs = prefs.break_length_min * 60000;

  for (const task of rankTasks(tasks)) {
    const need = Math.max(10, task.estimated_min || prefs.default_meeting_min) * 60000;
    let placed = false;
    for (let i = 0; i < gaps.length; i++) {
      const gap = gaps[i]!;
      const start = cursors[i]!;
      if (start + need <= gap.end) {
        placements.push({
          task_id: task.id,
          title: task.title,
          starts_at: new Date(start).toISOString(),
          ends_at: new Date(start + need).toISOString(),
          estimated_min: Math.round(need / 60000),
        });
        cursors[i] = start + need + breakMs;
        placed = true;
        break;
      }
    }
    if (!placed) unplaced.push(task);
  }
  return { placements, unplaced };
}
