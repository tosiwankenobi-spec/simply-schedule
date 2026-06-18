import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GMAIL_BASE = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

type GmailHeader = { name: string; value: string };
type GmailMessagePart = {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailMessagePart[];
};
type GmailMessage = {
  id: string;
  snippet?: string;
  payload?: { headers?: GmailHeader[] } & GmailMessagePart;
};

function decodeBase64Url(data: string): string {
  try {
    const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    if (typeof atob === "function") {
      const bin = atob(padded);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder("utf-8").decode(bytes);
    }
    // @ts-expect-error Buffer fallback for non-browser runtimes
    return Buffer.from(padded, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

function extractPlainText(part: GmailMessagePart | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  if (part.parts) {
    for (const p of part.parts) {
      const t = extractPlainText(p);
      if (t) return t;
    }
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    return decodeBase64Url(part.body.data).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return "";
}

async function gatewayFetch(path: string, lovableKey: string, gmailKey: string) {
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": gmailKey,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gmail API ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function aiExtract(text: string, lovableKey: string, nowIso: string, tzOffsetMin: number) {
  const localNow = new Date(Date.now() - tzOffsetMin * 60000).toISOString().replace("Z", "");
  const system = `You extract a single appointment from an email if and only if one is clearly present.

CURRENT CONTEXT
- Now (UTC): ${nowIso}
- Now (user local): ${localNow}
- Resolve relative phrases against user-local time.

DECIDE FIRST: Does this email describe a SPECIFIC scheduled appointment, meeting, reservation, flight, or event with a date AND time? Newsletters, marketing, receipts without an event, generic announcements → return {"appointment": false}.

If yes, return:
{"appointment": true, "title": string (action-first, <=60 chars, strip Re:/Fwd:/Invitation:), "starts_at": ISO 8601 with timezone offset (assume user's offset ${-tzOffsetMin} min if missing), "ends_at": ISO or null, "location": physical address/room/venue/video link or null, "notes": one short sentence or null}

Return ONLY JSON, no markdown.`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
  if (res.status === 429) throw new Error("AI rate limit reached.");
  if (res.status === 402) throw new Error("AI credits exhausted.");
  if (!res.ok) throw new Error(`AI request failed (${res.status})`);
  const json = await res.json();
  let content: string = json?.choices?.[0]?.message?.content ?? "";
  content = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    const parsed = JSON.parse(content);
    if (!parsed?.appointment || !parsed.title || !parsed.starts_at) return null;
    if (Number.isNaN(Date.parse(parsed.starts_at))) return null;
    if (parsed.ends_at && Number.isNaN(Date.parse(parsed.ends_at))) parsed.ends_at = null;
    return {
      title: String(parsed.title).slice(0, 200),
      starts_at: parsed.starts_at as string,
      ends_at: (parsed.ends_at ?? null) as string | null,
      location: parsed.location ? String(parsed.location).slice(0, 200) : null,
      notes: parsed.notes ? String(parsed.notes).slice(0, 1000) : null,
    };
  } catch {
    return null;
  }
}

export const importFromGmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const gmailKey = process.env.GOOGLE_MAIL_API_KEY;
    if (!lovableKey) throw new Error("Missing LOVABLE_API_KEY");
    if (!gmailKey) throw new Error("Gmail is not connected.");

    // Pull recent inbox messages, biased toward likely events
    const query = encodeURIComponent("in:inbox newer_than:14d (meeting OR appointment OR reservation OR invite OR scheduled OR confirmed OR flight OR booking)");
    const list = await gatewayFetch(
      `/users/me/messages?maxResults=15&q=${query}`,
      lovableKey,
      gmailKey,
    );
    const messages: { id: string }[] = list.messages ?? [];
    if (messages.length === 0) {
      return { scanned: 0, imported: 0, skipped: 0 };
    }

    const nowIso = new Date().toISOString();
    const tzOffsetMin = new Date().getTimezoneOffset();

    let imported = 0;
    let skipped = 0;

    for (const m of messages) {
      const externalId = `gmail:${m.id}`;
      // Skip if already imported
      const { data: existing } = await context.supabase
        .from("appointments")
        .select("id")
        .eq("user_id", context.userId)
        .eq("external_id", externalId)
        .maybeSingle();
      if (existing) { skipped++; continue; }

      let full: GmailMessage;
      try {
        full = await gatewayFetch(`/users/me/messages/${m.id}?format=full`, lovableKey, gmailKey);
      } catch { skipped++; continue; }

      const headers = full.payload?.headers ?? [];
      const subject = headers.find((h) => h.name.toLowerCase() === "subject")?.value ?? "";
      const from = headers.find((h) => h.name.toLowerCase() === "from")?.value ?? "";
      const date = headers.find((h) => h.name.toLowerCase() === "date")?.value ?? "";
      const body = extractPlainText(full.payload) || full.snippet || "";

      const text = `Subject: ${subject}\nFrom: ${from}\nDate: ${date}\n\n${body}`.slice(0, 8000);

      let parsed;
      try {
        parsed = await aiExtract(text, lovableKey, nowIso, tzOffsetMin);
      } catch { skipped++; continue; }

      if (!parsed) { skipped++; continue; }

      const { error } = await context.supabase.from("appointments").insert({
        user_id: context.userId,
        title: parsed.title,
        starts_at: parsed.starts_at,
        ends_at: parsed.ends_at,
        location: parsed.location,
        notes: parsed.notes,
        source: "gmail",
        external_id: externalId,
      });
      if (error) { skipped++; continue; }
      imported++;
    }

    return { scanned: messages.length, imported, skipped };
  });
