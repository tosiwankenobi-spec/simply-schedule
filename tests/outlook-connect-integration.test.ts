import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
type StoredConnection = {
  user_id: string;
  connector_id: string;
  connection_key_ciphertext: string;
  [key: string]: unknown;
};
type GatewayCall = { url: string; body: Record<string, unknown> };

const state = vi.hoisted(() => ({
  request: "https://verolane.online/auth",
  calls: [] as GatewayCall[],
  rows: new Map<string, StoredConnection>(),
  used: false,
}));
vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => new Request(state.request) }));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => {
  const filters: Record<string,string> = {};
  const chain = { upsert: async (row: StoredConnection) => { state.rows.set(row.user_id + ":" + row.connector_id, row); return { error: null }; }, select: () => chain, eq: (key: string, value: string) => { filters[key] = value; return chain; }, maybeSingle: async () => ({ data: state.rows.get(filters.user_id + ":" + filters.connector_id) ?? null, error: null }) };
  return chain;
} } }));
vi.mock("../src/lib/outlook.server", () => ({ refreshAccountLabel: async () => null, discoverCalendars: async () => [] }));
import { startOutlookConnectHandler, completeOutlookConnectHandler } from "../src/lib/outlook-connect.server";
import { getConnectionKeyForUser } from "../src/server/appUserConnections.server";
describe("Outlook actual connect/exchange/storage with synthetic gateway", () => {
  beforeEach(() => {
    state.calls = []; state.rows.clear(); state.used = false;
    vi.stubEnv("LOVABLE_API_KEY", "synthetic-workspace"); vi.stubEnv("MICROSOFT_OUTLOOK_APP_USER_CONNECTOR_CLIENT_API_KEY", "synthetic-client"); vi.stubEnv("APP_USER_CONNECTION_KEY_SECRET", Buffer.alloc(32, 7).toString("base64"));
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>; state.calls.push({ url, body });
      if (url.endsWith("/authorize")) return Response.json({ authorization_url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", session_id: "synthetic" });
      if (state.used) return Response.json({ error: "used" }, { status: 400 });
      state.used = true; return Response.json({ api_key: "synthetic-user-handle", connector_id: "microsoft_outlook" });
    });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  test("both Microsoft account types, least privilege and native return", async () => {
    await startOutlookConnectHandler({ data: { native: true }, context: { userId: "synthetic-user-a" } });
    const body = state.calls[0]?.body;
    expect(body?.["app_user_id"]).toBe("synthetic-user-a");
    expect(body?.["return_url"]).toBe("ca.verolane.chronosv://oauth/microsoft/return");
    const credentials = body?.["credentials_configuration"] as {
      domain_hint?: string;
      scopes?: string[];
    };
    expect(credentials.domain_hint).toBe("none");
    expect(credentials.scopes).toEqual([
      "openid",
      "profile",
      "email",
      "offline_access",
      "User.Read",
      "Calendars.ReadWrite",
      "Mail.Read",
    ]);
  });
  test("exchanges once, saves encrypted and never reads another user's handle", async () => {
    const input = { data: { code: "synthetic-one-time" }, context: { userId: "synthetic-user-a", supabase: {} } };
    expect(await completeOutlookConnectHandler(input)).toEqual({ ok: true });
    expect(
      state.rows.get("synthetic-user-a:microsoft_outlook")?.connection_key_ciphertext,
    ).not.toContain("synthetic-user-handle");
    expect(await getConnectionKeyForUser("synthetic-user-a", "microsoft_outlook")).toBe("synthetic-user-handle");
    expect(await getConnectionKeyForUser("synthetic-user-b", "microsoft_outlook")).toBeNull();
    expect(await getConnectionKeyForUser("synthetic-user-a", "google_mail")).toBeNull();
    await expect(completeOutlookConnectHandler(input)).rejects.toThrow("400");
  });
});