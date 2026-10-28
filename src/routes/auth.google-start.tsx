import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { googleReturnUrl } from "@/lib/google-auth-return";

export const Route = createFileRoute("/auth/google-start")({
  component: GoogleBrowserStart,
  head: () => ({ meta: [
    { title: "Google sign-in for Android · Chronos-V" },
    { name: "description", content: "Continue Google sign-in in your secure browser for Chronos-V." },
    { property: "og:title", content: "Google sign-in for Android · Chronos-V" },
    { property: "og:description", content: "Continue Google sign-in securely for Chronos-V." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
});

function GoogleBrowserStart() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function start() {
    setBusy(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: googleReturnUrl(window.location.origin, true),
      });
      if (result.error) throw new Error("Google sign-in could not be started. Please try again.");
      if (!result.redirected) window.location.replace(googleReturnUrl(window.location.origin, true));
    } catch { setError("Google sign-in could not be started. Please try again."); setBusy(false); }
  }
  return <main className="grid min-h-screen place-items-center bg-background px-6">
    <div className="max-w-sm space-y-4 text-center">
      <h1 className="font-serif text-2xl">Sign in to Chronos-V</h1>
      <Button onClick={() => void start()} disabled={busy}>{busy ? "Connecting…" : "Continue with Google"}</Button>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  </main>;
}