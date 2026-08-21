import { useMemo, useRef, useState } from "react";
import { addDays, format, isSameDay, startOfWeek } from "date-fns";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, MapPin } from "lucide-react";

export type WeekAppointment = {
  id: string;
  title: string;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  source: string;
};

const SLOT_MIN = 30;
const PX_PER_MIN = 1; // 30px per slot
const START_HOUR = 6;
const END_HOUR = 22;

export function WeekGrid({
  items,
  onMove,
}: {
  items: WeekAppointment[];
  onMove: (id: string, startsAt: string, endsAt: string | null) => void;
}) {
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [dragId, setDragId] = useState<string | null>(null);
  const [hover, setHover] = useState<{ day: number; min: number } | null>(null);
  const colRefs = useRef<(HTMLDivElement | null)[]>([]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(anchor, i)), [anchor]);
  const hours = useMemo(
    () => Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i),
    [],
  );
  const gridHeight = (END_HOUR - START_HOUR) * 60 * PX_PER_MIN;

  function minutesFromTop(date: Date) {
    return (date.getHours() - START_HOUR) * 60 + date.getMinutes();
  }

  function slotFromEvent(dayIdx: number, clientY: number) {
    const el = colRefs.current[dayIdx];
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const raw = (clientY - rect.top) / PX_PER_MIN;
    const snapped = Math.round(raw / SLOT_MIN) * SLOT_MIN;
    const min = Math.max(0, Math.min((END_HOUR - START_HOUR) * 60 - SLOT_MIN, snapped));
    return min;
  }

  function drop(dayIdx: number, clientY: number) {
    if (!dragId) return;
    const min = slotFromEvent(dayIdx, clientY);
    setHover(null);
    setDragId(null);
    if (min === null) return;
    const appt = items.find((a) => a.id === dragId);
    if (!appt) return;

    const start = new Date(appt.starts_at);
    const end = appt.ends_at ? new Date(appt.ends_at) : null;
    const durationMs = end ? end.getTime() - start.getTime() : null;

    const target = new Date(days[dayIdx]!);
    target.setHours(START_HOUR, 0, 0, 0);
    target.setMinutes(target.getMinutes() + min);
    if (target.getTime() === start.getTime()) return;

    onMove(
      appt.id,
      target.toISOString(),
      durationMs !== null ? new Date(target.getTime() + durationMs).toISOString() : null,
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Previous week" onClick={() => setAnchor(addDays(anchor, -7))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Next week" onClick={() => setAnchor(addDays(anchor, 7))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="ml-2 font-serif text-lg">
            {format(anchor, "MMM d")} – {format(addDays(anchor, 6), "MMM d, yyyy")}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setAnchor(startOfWeek(new Date(), { weekStartsOn: 1 }))}
        >
          Today
        </Button>
      </div>

      <p className="mb-2 text-xs text-muted-foreground">Drag any block to a new day or time.</p>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <div className="min-w-[640px]">
          <div className="grid grid-cols-[48px_repeat(7,1fr)] border-b border-border">
            <div />
            {days.map((d) => (
              <div
                key={d.toISOString()}
                className={`px-2 py-2 text-center text-xs ${isSameDay(d, new Date()) ? "text-accent" : "text-muted-foreground"}`}
              >
                <div className="font-medium">{format(d, "EEE")}</div>
                <div>{format(d, "d")}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-[48px_repeat(7,1fr)]">
            <div className="relative" style={{ height: gridHeight }}>
              {hours.map((h) => (
                <div
                  key={h}
                  className="absolute right-1 -translate-y-1/2 text-[10px] text-muted-foreground"
                  style={{ top: (h - START_HOUR) * 60 * PX_PER_MIN }}
                >
                  {format(new Date(2000, 0, 1, h), "h a")}
                </div>
              ))}
            </div>

            {days.map((day, dayIdx) => {
              const dayItems = items.filter((a) => isSameDay(new Date(a.starts_at), day));
              return (
                <div
                  key={day.toISOString()}
                  ref={(el) => { colRefs.current[dayIdx] = el; }}
                  className="relative border-l border-border"
                  style={{ height: gridHeight }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    const min = slotFromEvent(dayIdx, e.clientY);
                    if (min !== null) setHover({ day: dayIdx, min });
                  }}
                  onDragLeave={() => setHover((h) => (h?.day === dayIdx ? null : h))}
                  onDrop={(e) => { e.preventDefault(); drop(dayIdx, e.clientY); }}
                >
                  {hours.map((h) => (
                    <div
                      key={h}
                      className="absolute inset-x-0 border-t border-border/60"
                      style={{ top: (h - START_HOUR) * 60 * PX_PER_MIN }}
                    />
                  ))}

                  {hover?.day === dayIdx && (
                    <div
                      className="pointer-events-none absolute inset-x-1 rounded-md bg-accent/20 ring-1 ring-accent"
                      style={{ top: hover.min * PX_PER_MIN, height: SLOT_MIN * PX_PER_MIN }}
                    />
                  )}

                  {dayItems.map((a) => {
                    const start = new Date(a.starts_at);
                    const end = a.ends_at ? new Date(a.ends_at) : new Date(start.getTime() + 30 * 60000);
                    const top = minutesFromTop(start) * PX_PER_MIN;
                    const height = Math.max(
                      20,
                      ((end.getTime() - start.getTime()) / 60000) * PX_PER_MIN,
                    );
                    return (
                      <div
                        key={a.id}
                        draggable
                        onDragStart={() => setDragId(a.id)}
                        onDragEnd={() => { setDragId(null); setHover(null); }}
                        title={`${a.title} · ${format(start, "h:mm a")}`}
                        className={`absolute inset-x-1 cursor-grab overflow-hidden rounded-md border px-1.5 py-1 text-[11px] leading-tight active:cursor-grabbing ${
                          a.source === "task"
                            ? "border-accent/50 bg-accent/15 text-foreground"
                            : "border-border bg-secondary text-foreground"
                        } ${dragId === a.id ? "opacity-50" : ""}`}
                        style={{ top: Math.max(0, top), height }}
                      >
                        <span className="block truncate font-medium">{a.title}</span>
                        <span className="block truncate text-muted-foreground">
                          {format(start, "h:mm")}
                          {a.location ? (
                            <span className="ml-1 inline-flex items-center gap-0.5">
                              <MapPin className="inline h-2.5 w-2.5" />
                              {a.location}
                            </span>
                          ) : null}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
