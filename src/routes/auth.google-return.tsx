import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { GOOGLE_NATIVE_OPEN_URL, googleReturnDestination } from "@/lib/google-auth-return";

export const Route = createFileRoute("/auth/google-return")({
  component: GoogleReturn,
  head: () => ({ meta: [
    { title: "Return from Google sign-in · Chronos-V" },
    { name: "description", content: "Check your Chronos-V session and return safely from Google sign-in." },
    { property: "og:title", content: "Return from Google sign-in · Chronos-V" },
    { property: "og:description", content: "Return safely to Chronos-V after Google sign-in." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
});

function GoogleReturn() {
  const [state, setState] = useState<"checking" | "browser" | "signin">("checking");
  useEffect(() => {
    let active = true;
    const nativeReturn = new URLSearchParams(window.location.search).get("native") === "1";
    // Auth owns URL/session processing. Never copy fragment tokens into a deep link.
    void supabase.auth.getUser().then(async ({ data, error }) => {
      if (!active) return;
      const destination = googleReturnDestination(!error && Boolean(data.user), sessionStorage.getItem("chronos-google-next"));
      sessionStorage.removeItem("chronos-google-next");
      window.history.replaceState(null, "", nativeReturn ? "/auth/google-return?native=1" : "/auth/google-return");
      if (destination && (!nativeReturn || Capacitor.isNativePlatform())) {
        if (Capacitor.isNativePlatform()) {
          const { Browser } = await import("@capacitor/browser");
          await Browser.close().catch(() => undefined);
        }
        window.location.replace(destination);
      } else setState(destination ? "browser" : "signin");
    }).catch(() => { if (active) setState("signin"); });
    return () => { active = false; };
  }, []);
  return <main className="grid min-h-screen place-items-center bg-background px-6">
    <div className="max-w-sm space-y-4 text-center">
      <h1 className="font-serif text-2xl">Chronos-V</h1>
      <p role="status" className="text-sm text-muted-foreground">{state === "checking" ? "Checking your sign-in…" : state === "browser" ? "You are signed in in this browser. Android sign-in must be completed separately in the app." : "No app session was received. Sign in to continue."}</p>
      {state !== "checking" ? <>
        <Button asChild><a href={GOOGLE_NATIVE_OPEN_URL}>Open Chronos-V</a></Button>
        <Button asChild variant="outline"><Link to="/auth">Sign in here</Link></Button>
      </> : null}
    </div>
  </main>;
}