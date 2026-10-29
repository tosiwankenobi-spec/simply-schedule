import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import {
  GOOGLE_BROWSER_CHALLENGE_KEY,
  GOOGLE_BROWSER_STATE_KEY,
  googleReturnUrl,
  isValidNativeGoogleChallenge,
  isValidNativeGoogleState,
} from "@/lib/google-auth-return";

export const Route = createFileRoute("/auth/google-start")({
  component: GoogleBrowserStart,
  head: () => ({
    meta: [
      { title: "Google sign-in for Android · Chronos-V" },
      {
        name: "description",
        content: "Continue Google sign-in in your secure browser for Chronos-V.",
      },
      { property: "og:title", content: "Google sign-in for Android · Chronos-V" },
      { property: "og:description", content: "Continue Google sign-in securely for Chronos-V." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function GoogleBrowserStart() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flowReady, setFlowReady] = useState(false);

  useEffect(() => {
    const fragment = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
    const params = new URLSearchParams(fragment);
    const challenge = params.get("challenge");
    const state = params.get("state");
    if (isValidNativeGoogleChallenge(challenge) && isValidNativeGoogleState(state)) {
      sessionStorage.setItem(GOOGLE_BROWSER_CHALLENGE_KEY, challenge);
      sessionStorage.setItem(GOOGLE_BROWSER_STATE_KEY, state);
      setFlowReady(true);
    } else {
      sessionStorage.removeItem(GOOGLE_BROWSER_CHALLENGE_KEY);
      sessionStorage.removeItem(GOOGLE_BROWSER_STATE_KEY);
      setError("Please start Google sign-in from the Chronos-V app.");
    }
    window.history.replaceState(null, "", "/auth/google-start");
  }, []);

  async function start() {
    const challenge = sessionStorage.getItem(GOOGLE_BROWSER_CHALLENGE_KEY);
    const state = sessionStorage.getItem(GOOGLE_BROWSER_STATE_KEY);
    if (!isValidNativeGoogleChallenge(challenge) || !isValidNativeGoogleState(state)) {
      setError("Please restart Google sign-in from the Chronos-V app.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: googleReturnUrl(window.location.origin, true),
      });
      if (result.error) throw new Error("Google sign-in could not be started. Please try again.");
      if (!result.redirected)
        window.location.replace(googleReturnUrl(window.location.origin, true));
    } catch {
      sessionStorage.removeItem(GOOGLE_BROWSER_CHALLENGE_KEY);
      sessionStorage.removeItem(GOOGLE_BROWSER_STATE_KEY);
      setError("Google sign-in could not be started. Please try again.");
      setBusy(false);
    }
  }
  return (
    <main className="grid min-h-screen place-items-center bg-background px-6">
      <div className="max-w-sm space-y-4 text-center">
        <h1 className="font-serif text-2xl">Sign in to Chronos-V</h1>
        <Button onClick={() => void start()} disabled={busy || !flowReady}>
          {busy ? "Connecting…" : "Continue with Google"}
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </main>
  );
}
