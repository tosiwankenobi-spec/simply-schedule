export type BusyInterval = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  is_all_day?: boolean;
};

export type PlacementConflict = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
};

export type PlacementAlternative = {
  startsAt: string;
  endsAt: string;
  distanceMinutes: number;
  direction: "earlier" | "later";
};

type Gap = { start: number; end: number };

const DEFAULT_DURATION_MS = 30 * 60_000;

function intervalEnd(startsAt: string, endsAt: string | null) {
  const start = Date.parse(startsAt);
  const parsedEnd = endsAt ? Date.parse(endsAt) : Number.NaN;
  return Number.isFinite(parsedEnd) && parsedEnd > start ? parsedEnd : start + DEFAULT_DURATION_MS;
}

export function intervalsOverlap(
  first: { start: number; end: number },
  second: { start: number; end: number },
) {
  return first.start < second.end && first.end > second.start;
}

export function findPlacementConflicts(
  startsAt: string,
  endsAt: string | null,
  events: BusyInterval[],
  excludeId?: string | null,
): PlacementConflict[] {
  const start = Date.parse(startsAt);
  const end = intervalEnd(startsAt, endsAt);

  return events.flatMap((event) => {
    if (event.id === excludeId || event.is_all_day) return [];
    const eventStart = Date.parse(event.starts_at);
    const eventEnd = intervalEnd(event.starts_at, event.ends_at);
    if (!intervalsOverlap({ start, end }, { start: eventStart, end: eventEnd })) return [];
    return [
      {
        id: event.id,
        title: event.title,
        startsAt: event.starts_at,
        endsAt: new Date(eventEnd).toISOString(),
      },
    ];
  });
}

/** Ranks the closest start in each safe gap without changing the appointment duration. */
export function rankPlacementAlternatives(
  requestedStartsAt: string,
  requestedEndsAt: string | null,
  gaps: Gap[],
  limit = 3,
): PlacementAlternative[] {
  const requestedStart = Date.parse(requestedStartsAt);
  const duration = intervalEnd(requestedStartsAt, requestedEndsAt) - requestedStart;
  const seen = new Set<number>();

  return gaps
    .flatMap((gap) => {
      if (gap.end - gap.start < duration) return [];
      const latestStart = gap.end - duration;
      const startsAt = Math.max(gap.start, Math.min(requestedStart, latestStart));
      if (startsAt === requestedStart || seen.has(startsAt)) return [];
      seen.add(startsAt);
      return [
        {
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(startsAt + duration).toISOString(),
          distanceMinutes: Math.round(Math.abs(startsAt - requestedStart) / 60_000),
          direction: startsAt < requestedStart ? ("earlier" as const) : ("later" as const),
        },
      ];
    })
    .sort((a, b) => a.distanceMinutes - b.distanceMinutes || a.startsAt.localeCompare(b.startsAt))
    .slice(0, limit);
}
