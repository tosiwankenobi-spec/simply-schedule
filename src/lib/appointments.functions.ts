import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const parseSchema = z.object({
  text: z.string().min(1).max(8000),
  now: z.string().optional(),
});

export type ParsedAppointment = {
  title: string;
  starts_at: string; // ISO
  ends_at: string | null;
  location: string | null;
  notes: string | null;
};

export const parseAppointmentWithAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => parseSchema.parse(input))
  .handler(async ({ data }): Promise<ParsedAppointment> => {
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    if (!LOVABLE_API_KEY) throw new Error("Missing LOVABLE_API_KEY");

    const now = data.now ?? new Date().toISOString();
    const tzOffsetMin = new Date().getTimezoneOffset();
    const localNow = new Date(Date.now() - tzOffsetMin * 60000).toISOString().replace("Z", "");

    const system = `You are an expert appointment extractor. Pull ONE appointment from the user's text (which may be an email, calendar invite, forwarded message, or freeform note).

CURRENT CONTEXT
- Now (UTC ISO): ${now}
- Now (user local, no tz): ${localNow}
- Resolve relative phrases ("today", "tomorrow", "tonight", "next Friday", "in 2 hours", "this weekend") against the user-local time above.
- If a date is given without a year, pick the next future occurrence.
- If a time has no AM/PM, prefer the next plausible future time.
- Only set ends_at if the text states or strongly implies it.

EXTRACTION RULES
- title: short, human, action-first. Strip "Re:", "Fwd:", "Invitation:", "Reminder:". Examples: "Dentist", "Lunch with Maya", "Standup", "Flight to Berlin". Max ~60 chars. Never blank — if unclear, summarize the subject in 2-4 words.
- starts_at: ISO 8601 WITH timezone offset (e.g. "2026-06-18T15:00:00-07:00"). If no timezone in text, assume the user's local timezone (offset ${-tzOffsetMin} minutes from UTC).
- ends_at: ISO 8601 with offset, or null.
- location: physical address, room, venue, OR a video link (Zoom/Meet/Teams URL). Check for "at ___", "in ___", "Location:", "Where:", "Join:", or any zoom/meet/teams URL. null if truly absent.
- notes: one short sentence of extra context (agenda, attendees, confirmation #), or null. Do NOT repeat title/time/location.

OUTPUT
Return ONLY a JSON object (no markdown, no prose) with exactly these keys:
{"title": string, "starts_at": string, "ends_at": string|null, "location": string|null, "notes": string|null}`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: data.text },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      }),
    });

    if (res.status === 429) throw new Error("Rate limit reached, try again in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted — add credits in Settings.");
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`AI request failed (${res.status}): ${body.slice(0, 200)}`);
    }

    const json = await res.json();
    let content: string = json?.choices?.[0]?.message?.content ?? "";
    content = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    let parsed: ParsedAppointment;
    try {
      parsed = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("AI returned malformed JSON. Try rephrasing.");
      try { parsed = JSON.parse(m[0]); } catch { throw new Error("AI returned malformed JSON. Try rephrasing."); }
    }
    if (!parsed.title || !parsed.starts_at) {
      throw new Error("Couldn't find a clear title and start time. Try adding more detail.");
    }
    if (Number.isNaN(Date.parse(parsed.starts_at))) {
      throw new Error("AI returned an invalid start time. Try rephrasing.");
    }
    if (parsed.ends_at && Number.isNaN(Date.parse(parsed.ends_at))) {
      parsed.ends_at = null;
    }
    return {
      title: String(parsed.title).slice(0, 200),
      starts_at: parsed.starts_at,
      ends_at: parsed.ends_at ?? null,
      location: parsed.location ? String(parsed.location).slice(0, 200) : null,
      notes: parsed.notes ? String(parsed.notes).slice(0, 1000) : null,
    };
  });
