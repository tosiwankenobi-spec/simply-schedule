import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

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
    const params = new URLSearchParams(window.location.search);
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

    if (params.get("success") !== "true") {
      setMessage(params.get("error") ?? "The Microsoft sign-in did not complete.");
      notify("appUserConnectorOAuthFailed");
      return;
    }
    const code = params.get("code");
    if (!code) {
      if (params.get("offline_access_allowed") === "false") {
        notify("appUserConnectorOAuthComplete");
        return;
      }
      setMessage("Microsoft sign-in finished without a completion code.");
      notify("appUserConnectorOAuthFailed");
      return;
    }
    notify("appUserConnectorOAuthComplete", code);
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 text-center">
      <p className="max-w-sm text-sm text-muted-foreground" role="status" aria-live="polite">
        {message}
      </p>
    </main>
  );
}
