import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LoaderCircle } from "lucide-react";

export const Route = createFileRoute("/")({
  component: IndexRedirect,
  head: () => ({
    meta: [
      { title: "Chronos-V — Your schedule, synthesized" },
      {
        name: "description",
        content:
          "Chronos-V turns your email, calendar, and notes into one planned day, with smart scheduling and reminders.",
      },
      { property: "og:title", content: "Chronos-V — Your schedule, synthesized" },
      {
        property: "og:description",
        content:
          "Chronos-V turns your email, calendar, and notes into one planned day, with smart scheduling and reminders.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://verolane.online/" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://verolane.online/" }],
  }),
});

function IndexRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      navigate({ to: data.user ? "/app" : "/auth", replace: true });
    });
  }, [navigate]);
  return (
    <main className="verolane-wash relative flex min-h-screen items-center justify-center bg-background px-4">
      <div className="pointer-events-none absolute inset-0 paper-grain opacity-20" />
      <div className="relative text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-ink shadow-[0_20px_50px_rgba(0,46,40,0.16)]">
          <img src="/favicon.png" alt="" className="h-9 w-9" />
        </span>
        <h1 className="mt-4 font-serif text-xl text-foreground">
          Chronos-V — your schedule, synthesized
        </h1>
        <div className="mt-2 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          <span>Opening your schedule…</span>
        </div>
      </div>
    </main>
  );
}
