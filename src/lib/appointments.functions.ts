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

    const system = `You extract a single appointment from text (an email, a forwarded invite, or a short description).
Today's date/time (ISO, user's local converted to UTC) is: ${now}.
Return ONLY valid JSON matching this TypeScript type — no prose, no markdown fence:
{ "title": string, "starts_at": string (ISO 8601 with timezone offset), "ends_at": string | null, "location": string | null, "notes": string | null }
If the user says "tomorrow", "next Tuesday", etc., resolve relative to the date above.
If no end time is given, set ends_at to null.
Title should be short and human (e.g. "Dentist", "Lunch with Maya"). Keep notes short or null.`;

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
      }),
    });

    if (res.status === 429) throw new Error("Rate limit reached, try again in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted — add credits in Settings.");
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`AI request failed (${res.status}): ${body.slice(0, 200)}`);
    }

    const json = await res.json();
    const content: string = json?.choices?.[0]?.message?.content ?? "";
    let parsed: ParsedAppointment;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("AI returned malformed JSON. Try rephrasing.");
    }
    if (!parsed.title || !parsed.starts_at) {
      throw new Error("Couldn't find a clear title and start time. Try adding more detail.");
    }
    return {
      title: String(parsed.title).slice(0, 200),
      starts_at: parsed.starts_at,
      ends_at: parsed.ends_at ?? null,
      location: parsed.location ? String(parsed.location).slice(0, 200) : null,
      notes: parsed.notes ? String(parsed.notes).slice(0, 1000) : null,
    };
  });
