/**
 * Authenticated server functions for per-user Microsoft Outlook sync.
 * Every function derives the user from the verified session — never from input.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { OUTLOOK_CONNECTOR_ID } from "./outlook";
import type { OutlookCalendar, OutlookStatus, OutlookSyncResult } from "./outlook.server";

export type { OutlookCalendar, OutlookStatus, OutlookSyncResult };

const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";

const MICROSOFT_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Calendars.ReadWrite",
];

export const startOutlookConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ authorizationUrl: string }> => {
    const clientKey = process.env["MICROSOFT_OUTLOOK_APP_USER_CONNECTOR_CLIENT_API_KEY"];
    if (!clientKey) throw new Error("Outlook is not configured for this workspace yet.");

    const request = getRequest();
    if (!request) throw new Error("Connecting Outlook must start from the app.");
    const url = new URL(request.url);
    const sandboxHost =
      url.hostname === "localhost" ? request.headers.get("x-forwarded-host") : null;
    const returnUrl = new URL(
      "/oauth/microsoft/return",
      sandboxHost ? `https://${sandboxHost}` : url.origin,
    ).toString();

    const { authorizeAppUserOAuth } = await import("@/integrations/lovable/appUserConnector");
    const { getConnectionKeyForUser } = await import("@/server/appUserConnections.server");
    const existing = await getConnectionKeyForUser(context.userId, OUTLOOK_CONNECTOR_ID);

    const { authorizationUrl } = await authorizeAppUserOAuth({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectorId: OUTLOOK_CONNECTOR_ID,
      appUserId: context.userId,
      clientAPIKey: clientKey,
      returnUrl,
      connectionAPIKey: existing ?? undefined,
      credentialsConfiguration: {
        scopes: MICROSOFT_SCOPES,
        domain_hint: "none",
        prompt: "select_account",
      },
    });
    return { authorizationUrl };
  });

export const completeOutlookConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { code: string }) => {
    if (!input || typeof input.code !== "string" || !input.code.trim()) {
      throw new Error("Missing connection code.");
    }
    return { code: input.code };
  })
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { exchangeAppUserOAuthCode } = await import("@/integrations/lovable/appUserConnector");
    const { saveConnectionKeyForUser } = await import("@/server/appUserConnections.server");
    const { connectionAPIKey, connectorId } = await exchangeAppUserOAuthCode(
      GATEWAY_BASE_URL,
      data.code,
    );
    if (connectorId !== OUTLOOK_CONNECTOR_ID) {
      throw new Error("That connection was for a different service.");
    }
    await saveConnectionKeyForUser(context.userId, connectorId, connectionAPIKey);

    const { refreshAccountLabel, discoverCalendars } = await import("./outlook.server");
    await refreshAccountLabel(context.userId);
    try {
      await discoverCalendars(context.supabase as never, context.userId);
    } catch {
      /* the setup screen can retry discovery */
    }
    return { ok: true };
  });

export const getOutlookStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OutlookStatus> => {
    const { readOutlookStatus } = await import("./outlook.server");
    return readOutlookStatus(context.supabase as never, context.userId);
  });

export const listOutlookCalendars = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OutlookCalendar[]> => {
    const { discoverCalendars } = await import("./outlook.server");
    return discoverCalendars(context.supabase as never, context.userId);
  });

export const selectOutlookCalendars = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { calendarIds: string[] }) => ({
    calendarIds: Array.isArray(input?.calendarIds)
      ? input.calendarIds.filter((id): id is string => typeof id === "string")
      : [],
  }))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { setSelectedCalendars } = await import("./outlook.server");
    await setSelectedCalendars(context.supabase as never, context.userId, data.calendarIds);
    return { ok: true };
  });

export const syncOutlookNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OutlookSyncResult> => {
    const { runOutlookSync } = await import("./outlook.server");
    return runOutlookSync(context.supabase as never, context.userId);
  });

/** Clears delta state so the next sync re-imports the full window. */
export const resetOutlookSyncState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OutlookSyncResult> => {
    const supabase = context.supabase as never as {
      from: (t: string) => {
        update: (p: unknown) => {
          eq: (c: string, v: string) => { like: (c: string, v: string) => Promise<unknown> };
        };
      };
    };
    await supabase
      .from("sync_state")
      .update({ sync_token: null, last_error: null })
      .eq("user_id", context.userId)
      .like("provider", "microsoft_outlook%");
    const { runOutlookSync } = await import("./outlook.server");
    return runOutlookSync(context.supabase as never, context.userId);
  });

export const disconnectOutlookAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true }> => {
    const { disconnectOutlook } = await import("./outlook.server");
    await disconnectOutlook(context.supabase as never, context.userId);
    return { ok: true };
  });

/** Separate, explicitly confirmed destructive action. */
export const deleteOutlookLocalCopies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { confirm: string }) => {
    if (input?.confirm !== "DELETE") throw new Error("Deletion was not confirmed.");
    return input;
  })
  .handler(async ({ context }): Promise<{ removed: number }> => {
    const { deleteLocalOutlookCopies } = await import("./outlook.server");
    return deleteLocalOutlookCopies(context.supabase as never, context.userId);
  });
