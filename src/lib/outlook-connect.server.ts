/**
 * Server-only implementation of the per-user Outlook connection handshake.
 * Kept separate from the client-importable server-function wrappers.
 */
import { getRequest } from "@tanstack/react-start/server";
import { OUTLOOK_CONNECTOR_ID, OUTLOOK_NATIVE_RETURN_URL } from "./outlook";

const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";
const MICROSOFT_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Calendars.ReadWrite",
  "Mail.Read",
];

export async function startOutlookConnectHandler({ data, context }: {
  data: { native: boolean };
  context: { userId: string };
}): Promise<{ authorizationUrl: string }> {
    const clientKey = process.env["MICROSOFT_OUTLOOK_APP_USER_CONNECTOR_CLIENT_API_KEY"];
    if (!clientKey) throw new Error("Outlook is not configured for this workspace yet.");

    const request = getRequest();
    if (!request) throw new Error("Connecting Outlook must start from the app.");
    const url = new URL(request.url);
    const sandboxHost =
      url.hostname === "localhost" ? request.headers.get("x-forwarded-host") : null;
    const returnUrl = data.native
      ? OUTLOOK_NATIVE_RETURN_URL
      : new URL(
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
}

export async function completeOutlookConnectHandler({ data, context }: {
  data: { code: string };
  context: { userId: string; supabase: unknown };
}): Promise<{ ok: true }> {
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
}
