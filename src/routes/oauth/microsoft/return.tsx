import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Capacitor } from "@capacitor/core";
import { completeOutlookConnect } from "@/lib/outlook.functions";
import { parseOutlookOAuthCallback } from "@/lib/outlook";

export const Route = createFileRoute("/oauth/microsoft/return")({
  component: OutlookOAuthReturn,
  head: () => ({
    meta: [
      { title: "Finishing Microsoft connection · Chronos-V" },
      {
        name: "description",
        content:
          "Chronos-V is completing the private Microsoft Outlook connection for your account.",
      },
    ],
  }),
});

const CONNECTOR_ID = "microsoft_outlook";

function OutlookOAuthReturn() {
  const [message, setMessage] = useState("Finishing your Microsoft connection…");

  useEffect(() => {
    const result = parseOutlookOAuthCallback(window.location.search);
    const hasOpener = Boolean(window.opener);
    const notify = (
      type: "appUserConnectorOAuthComplete" | "appUserConnectorOAuthFailed",
      code?: string,
    ) => {
      window.opener?.postMessage(
        { type, connectorId: CONNECTOR_ID, code: code ?? null },
        window.location.origin,
      );
      window.close();
    };

    if (!result.ok) {
      setMessage(result.message);
      notify("appUserConnectorOAuthFailed");
      return;
    }

    if (hasOpener) {
      notify("appUserConnectorOAuthComplete", result.code);
      return;
    }

    // Native Android returns through a custom URL scheme into this same WebView,
    // where the existing signed-in session can safely exchange the one-time code.
    void completeOutlookConnect({ data: { code: result.code } })
      .then(async () => {
        setMessage("Outlook connected. Returning to your calendars…");
        if (Capacitor.isNativePlatform()) {
          const { Browser } = await import("@capacitor/browser");
          await Browser.close().catch(() => undefined);
        }
        window.setTimeout(() => window.location.replace("/setup/outlook"), 450);
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "Outlook could not be connected.");
      });
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 text-center">
      <p className="max-w-sm text-sm text-muted-foreground" role="status" aria-live="polite">
        {message}
      </p>
    </main>
  );
}
