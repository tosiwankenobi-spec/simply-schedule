import { normalizeSmartInboxExtraction, type ParsedSmartInboxSuggestion } from "./smart-inbox";

export async function extractSmartInboxSuggestion(
  text: string,
  lovableKey: string,
  nowIso: string,
  tzOffsetMin: number,
): Promise<ParsedSmartInboxSuggestion | null> {
  const localNow = new Date(Date.now() - tzOffsetMin * 60000).toISOString().replace("Z", "");
  const system = `You extract one useful schedule or task suggestion from an email only when the obligation is explicit.

CURRENT CONTEXT
- Now (UTC): ${nowIso}
- Now (user local): ${localNow}
- Resolve relative phrases against user-local time.

SUPPORTED KINDS
- appointment, reservation, or school_event: use destination "schedule" and require a specific date AND time.
- delivery: use "schedule" when a delivery window has times; otherwise use "tasks" with the promised date as its deadline.
- renewal or deadline: use destination "tasks" and require a specific due date.

Newsletters, marketing, receipts without a future obligation, vague announcements, and messages without the required date return {"suggestion":false}.

If useful, return {"suggestion":true,"kind":"appointment|reservation|school_event|delivery|renewal|deadline","destination":"schedule|tasks","title":string,"starts_at":ISO 8601 with timezone offset or null,"ends_at":ISO or null,"deadline":"YYYY-MM-DD" or null,"estimated_min":5-480,"location":string or null,"notes":one short sentence or null}.
Assume the user's offset is ${-tzOffsetMin} minutes when the email omits one. Keep the title under 60 characters and remove reply/forward prefixes. Return ONLY JSON.`;

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: system },
        { role: "user", content: text.slice(0, 8000) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    }),
  });
  if (response.status === 429) throw new Error("Smart Inbox AI is busy. Try again shortly.");
  if (response.status === 402) throw new Error("Smart Inbox AI credits are exhausted.");
  if (!response.ok) throw new Error(`Smart Inbox AI failed (${response.status}).`);

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = (json.choices?.[0]?.message?.content ?? "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  try {
    return normalizeSmartInboxExtraction(JSON.parse(content));
  } catch {
    return null;
  }
}
