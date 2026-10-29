import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  googleNativeOpenUrl,
  isValidNativeGoogleState,
  isValidNativeHandoffCode,
} from "@/lib/google-auth-return";

export const Route = createFileRoute("/auth/google-handoff")({
  component: GoogleHandoff,
});

function GoogleHandoff() {
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null);
  const [message, setMessage] = useState("Returning to Chronos-V…");

  useEffect(() => {
    const fragment = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
    const params = new URLSearchParams(fragment);
    const handoffCode = params.get("handoff");
    const state = params.get("state");
    const native = params.get("native") === "1";
    const keys = Array.from(params.keys());
    const exactFragment =
      keys.length === 3 &&
      keys.every((key) => key === "native" || key === "handoff" || key === "state") &&
      params.getAll("native").length === 1 &&
      params.getAll("handoff").length === 1 &&
      params.getAll("state").length === 1;
    const hasUnexpectedQuery = window.location.search.length > 0;

    // This route is only the HTTPS App Link/fallback landing page. The native
    // app performs the actual exchange after validating its stored PKCE state.
    window.history.replaceState(null, "", "/auth/google-handoff");

    if (
      hasUnexpectedQuery ||
      !exactFragment ||
      !native ||
      !isValidNativeHandoffCode(handoffCode) ||
      !isValidNativeGoogleState(state)
    ) {
      setMessage("This Google sign-in link is invalid or expired. Please restart sign-in.");
      return;
    }

    const deepLink = googleNativeOpenUrl(handoffCode, state);
    setHandoffUrl(deepLink);
    setMessage("Google sign-in is ready. Opening Chronos-V…");
    // If Android has not verified the HTTPS App Link yet, use the PKCE-bound
    // custom-scheme fallback. The app still validates state and the verifier.
    window.location.href = deepLink;
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-background px-6">
      <div className="max-w-sm space-y-4 text-center">
        <h1 className="font-serif text-2xl">Chronos-V</h1>
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {message}
        </p>
        {handoffUrl ? (
          <Button asChild>
            <a href={handoffUrl}>Open Chronos-V</a>
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <Link to="/auth">Restart sign-in</Link>
        </Button>
      </div>
    </main>
  );
}
