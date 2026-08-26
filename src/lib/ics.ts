// Client-safe iCalendar (.ics) generation for exporting a plan to other calendar apps.

export type IcsEvent = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location?: string | null;
  notes?: string | null;
};

function escapeText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function toUtc(iso: string) {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** RFC 5545 asks for 75-octet lines; continuation lines start with a space. */
function fold(line: string) {
  if (line.length <= 74) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 74));
  rest = rest.slice(74);
  while (rest.length > 0) {
    parts.push(" " + rest.slice(0, 73));
    rest = rest.slice(73);
  }
  return parts.join("\r\n");
}

export function buildIcs(events: IcsEvent[], calendarName = "Chronos-V"): string {
  const stamp = toUtc(new Date().toISOString());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Chronos-V//Planner//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];

  for (const e of events) {
    const start = Date.parse(e.starts_at);
    if (!Number.isFinite(start)) continue;
    const end = e.ends_at && Number.isFinite(Date.parse(e.ends_at))
      ? new Date(e.ends_at).toISOString()
      : new Date(start + 30 * 60000).toISOString();
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.id}@chronos-v`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${toUtc(e.starts_at)}`,
      `DTEND:${toUtc(end)}`,
      fold(`SUMMARY:${escapeText(e.title)}`),
    );
    if (e.location) lines.push(fold(`LOCATION:${escapeText(e.location)}`));
    if (e.notes) lines.push(fold(`DESCRIPTION:${escapeText(e.notes)}`));
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export function downloadIcs(events: IcsEvent[], filename: string, calendarName?: string) {
  const blob = new Blob([buildIcs(events, calendarName)], {
    type: "text/calendar;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".ics") ? filename : `${filename}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
