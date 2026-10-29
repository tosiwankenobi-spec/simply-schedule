import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  createNativeGoogleHandoff,
  redeemNativeGoogleHandoff,
} from "@/lib/native-google-handoff.functions";
import {
  GOOGLE_BROWSER_CHALLENGE_KEY,
  GOOGLE_BROWSER_STATE_KEY,
  GOOGLE_NATIVE_NEXT_KEY,
  GOOGLE_NATIVE_STATE_KEY,
  GOOGLE_NATIVE_VERIFIER_KEY,
  googleNativeAppLinkUrl,
  googleNativeOpenUrl,
  googleReturnDestination,
  isValidNativeGoogleChallenge,
  isValidNativeGoogleState,
  isValidNativeHandoffCode,
} from "@/lib/google-auth-return";

export const Route = createFileRoute("/auth/google-return")({
  component: GoogleReturn,
  head: () => ({ meta: [
    { title: "Return from Google sign-in · Chronos-V" },
    { name: "description", content: "Complete Chronos-V sign-in securely." },
    { property: "og:title", content: "Return from Google sign-in · Chronos-V" },
    { property: "og:description", content: "Complete Chronos-V sign-in securely." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
});

type ReturnState = "checking" | "browser" | "signin" | "error";

function GoogleReturn() {
  const [state, setState] = useState<ReturnState>("checking");
  const [message, setMessage] = useState("Checking your sign-in…");
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const clearNativeAttempt = () => {
      localStorage.removeItem(GOOGLE_NATIVE_VERIFIER_KEY);
      localStorage.removeItem(GOOGLE_NATIVE_STATE_KEY);
      localStorage.removeItem(GOOGLE_NATIVE_NEXT_KEY);
    };

    async function run() {
      const params = new URLSearchParams(window.location.search);
      const nativeReturn = params.get("native") === "1";
      const handoffCode = params.get("handoff");
      const returnedState = params.get("state");
      const isNativeApp = Capacitor.isNativePlatform();

      // The handoff is encrypted and one-time. Remove it from browser history
      // immediately; never put access or refresh tokens in a deep-link URL.
      if (handoffCode !== null) {
        window.history.replaceState(null, "", "/auth/google-return");
        if (
          !isValidNativeHandoffCode(handoffCode) ||
          !isValidNativeGoogleState(returnedState)
        ) {
          setMessage("This Google sign-in link is invalid or expired. Please restart sign-in.");
          setState("error");
          return;
        }

        if (!isNativeApp) {
          setHandoffUrl(googleNativeOpenUrl(handoffCode, returnedState));
          setMessage("Google sign-in is ready. Open Chronos-V to finish securely.");
          setState("browser");
          return;
        }

        const verifier = localStorage.getItem(GOOGLE_NATIVE_VERIFIER_KEY);
        const expectedState = localStorage.getItem(GOOGLE_NATIVE_STATE_KEY);
        if (!verifier || !expectedState || expectedState !== returnedState) {
          clearNativeAttempt();
          setMessage("This Google sign-in attempt could not be verified. Please start again.");
          setState("error");
          return;
        }

        const session = await redeemNativeGoogleHandoff({
          data: { handoffCode, codeVerifier: verifier },
        });
        if (!session.access_token || !session.refresh_token) {
          throw new Error("Missing session");
        }
        const { error } = await supabase.auth.setSession(session);
        if (error) throw error;

        const next = localStorage.getItem(GOOGLE_NATIVE_NEXT_KEY);
        clearNativeAttempt();
        const destination = googleReturnDestination(true, next) ?? "/app";
        const { Browser } = await import("@capacitor/browser");
        await Browser.close().catch(() => undefined);
        window.location.replace(destination);
        return;
      }

      if (nativeReturn) {
        if (isNativeApp) {
          clearNativeAttempt();
          setMessage("The secure Google return code is missing. Please restart sign-in.");
          setState("error");
          return;
        }

        const challenge = sessionStorage.getItem(GOOGLE_BROWSER_CHALLENGE_KEY);
        const stateValue = sessionStorage.getItem(GOOGLE_BROWSER_STATE_KEY);
        if (
          !isValidNativeGoogleChallenge(challenge) ||
          !isValidNativeGoogleState(stateValue)
        ) {
          setMessage("The secure Google sign-in request expired. Please restart from Chronos-V.");
          setState("error");
          return;
        }

        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError || !userData.user) {
          sessionStorage.removeItem(GOOGLE_BROWSER_CHALLENGE_KEY);
          sessionStorage.removeItem(GOOGLE_BROWSER_STATE_KEY);
          setMessage("Google sign-in was not completed. Please try again.");
          setState("signin");
          return;
        }

        const { handoffCode: newHandoffCode } = await createNativeGoogleHandoff({
          data: { codeChallenge: challenge },
        });
        sessionStorage.removeItem(GOOGLE_BROWSER_CHALLENGE_KEY);
        sessionStorage.removeItem(GOOGLE_BROWSER_STATE_KEY);
        const deepLink = googleNativeOpenUrl(newHandoffCode, stateValue);
        setHandoffUrl(deepLink);
        setMessage("Google sign-in succeeded. Returning to Chronos-V…");
        setState("browser");
        window.location.href = googleNativeAppLinkUrl(window.location.origin, newHandoffCode, stateValue);
        return;
      }

      // Normal browser sign-in remains on the existing Lovable OAuth path.
      const { data: userData, error: userError } = await supabase.auth.getUser();
      const destination = googleReturnDestination(
        !userError && Boolean(userData.user),
        sessionStorage.getItem("chronos-google-next"),
      );
      sessionStorage.removeItem("chronos-google-next");
      window.history.replaceState(null, "", "/auth/google-return");

      if (destination) {
        window.location.replace(destination);
      } else {
        setMessage("No browser session was received. Sign in to continue.");
        setState("signin");
      }
    }

    void run().catch(() => {
      if (!active) return;
      sessionStorage.removeItem(GOOGLE_BROWSER_CHALLENGE_KEY);
      sessionStorage.removeItem(GOOGLE_BROWSER_STATE_KEY);
      if (Capacitor.isNativePlatform()) clearNativeAttempt();
      setMessage("Google sign-in could not be completed. Please restart sign-in.");
      setState("error");
    });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-background px-6">
      <div className="max-w-sm space-y-4 text-center">
        <h1 className="font-serif text-2xl">Chronos-V</h1>
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {message}
        </p>
        {state !== "checking" ? (
          <>
            {handoffUrl ? (
              <Button asChild>
                <a href={handoffUrl}>Open Chronos-V</a>
              </Button>
            ) : null}
            <Button asChild variant="outline">
              <Link to="/auth">Sign in again</Link>
            </Button>
          </>
        ) : null}
      </div>
    </main>
  );
}
