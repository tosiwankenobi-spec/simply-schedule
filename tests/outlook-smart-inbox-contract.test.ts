import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const auth = read("src/lib/outlook.functions.ts");
const functions = read("src/lib/outlook-inbox.functions.ts");
const server = read("src/lib/outlook-inbox.server.ts");
const privacy = read("src/lib/privacy.server.ts");
const migration = read("supabase/migrations/20260907015421_outlook_smart_inbox.sql");

describe("Outlook Smart Inbox security contract", () => {
  test("requests delegated read-only mail access", () => {
    expect(auth).toContain('"Mail.Read"');
    expect(auth).not.toContain('"Mail.ReadWrite"');
    expect(auth).not.toContain('"Mail.Send"');
  });

  test("authenticates every operation and derives ownership from the session", () => {
    expect(functions.match(/\.middleware\(\[requireSupabaseAuth\]\)/g)).toHaveLength(3);
    expect(functions).toContain("context.userId");
    expect(functions).not.toMatch(/userId:\s*z\./);
  });

  test("uses the encrypted per-user connection without returning its key", () => {
    expect(server).toContain("getConnectionKeyForUser(userId, OUTLOOK_CONNECTOR_ID)");
    expect(server).toContain("callAsAppUser({");
    const candidateShape = server.slice(
      server.indexOf("const candidate: SmartInboxCandidate"),
      server.indexOf("candidate.proof ="),
    );
    expect(candidateShape).not.toContain("connectionKey");
    expect(server).toContain("connectionFingerprint");
    expect(server).toContain("validProof(candidate, lovableKey)");
  });

  test("keeps email approvals outside calendar-sync ownership", () => {
    expect(server).toContain('const SOURCE = "outlook_mail"');
    expect(server).toContain('provider: "microsoft_outlook"');
    expect(server).toContain("calendar_event_id: null");
    expect(server).toContain("outlook-mail:");
    expect(server).not.toContain('source: "microsoft_outlook"');
  });

  test("never persists raw message bodies or raw Microsoft message ids", () => {
    const insertArea = server.slice(server.indexOf('.from("appointments").insert({'));
    expect(insertArea).not.toContain("body:");
    expect(insertArea).not.toContain("messageId:");
    expect(server).toContain("outlook_message_key: key");
    expect(server).toContain("messageKey: messageKey(fingerprint, messageId)");
  });

  test("has independent privacy pause and deletion controls", () => {
    expect(privacy).toContain('provider === "outlook_mail"');
    expect(privacy).toContain("outlook_mail_sync_enabled: enabled");
    expect(privacy).toContain("outlook_mail_sync_enabled: false");
    expect(privacy).toContain('.eq("source", source)');
    expect(privacy).toContain('.like("kind", "outlook_mail_%")');
  });

  test("preserves RLS through an invoker-security view", () => {
    expect(migration).toContain("outlook_mail_sync_enabled boolean NOT NULL DEFAULT true");
    expect(migration).toContain("WITH (security_invoker = true)");
    expect(migration).toContain("WHEN a.source = 'outlook_mail' THEN 'Outlook email'");
    expect(migration).toContain("REVOKE ALL ON public.schedule_hub_events FROM PUBLIC");
    expect(migration).toContain("REVOKE ALL ON public.schedule_hub_events FROM anon");
    expect(migration).toContain(
      "GRANT SELECT ON public.schedule_hub_events TO authenticated, service_role",
    );
  });
});
