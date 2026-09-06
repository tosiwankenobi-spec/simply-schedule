import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { ArrowLeft, CloudOff, Share2, Smartphone } from "lucide-react";
import { QuickCapture } from "@/components/QuickCapture";
import { Button } from "@/components/ui/button";

const sharedTextSchema = z.object({
  title: z.string().max(500).optional(),
  text: z.string().max(2000).optional(),
  url: z.string().max(2000).optional(),
});

export const Route = createFileRoute("/_authenticated/capture")({
  validateSearch: sharedTextSchema,
  component: CapturePage,
  head: () => ({
    meta: [
      { title: "Capture · Chronos-V" },
      {
        name: "description",
        content: "Capture a commitment or task quickly, even when your device is offline.",
      },
    ],
  }),
});

function CapturePage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const { user } = Route.useRouteContext();
  const initialText = [search.title, search.text, search.url].filter(Boolean).join(" — ");

  return (
    <div className="verolane-wash relative min-h-screen bg-background">
      <div className="pointer-events-none absolute inset-0 paper-grain opacity-20" />
      <main className="relative mx-auto max-w-3xl px-4 py-5 sm:px-6 sm:py-10">
        <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
          <Link to="/today">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Today
          </Link>
        </Button>

        <section className="mt-4 overflow-hidden rounded-3xl bg-ink px-5 py-6 text-paper shadow-[0_22px_55px_rgba(0,46,40,0.16)] sm:px-8 sm:py-8">
          <div className="flex items-start gap-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-paper/10 text-gold ring-1 ring-paper/15">
              <Smartphone className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-leaf">
                Mobile capture
              </p>
              <h1 className="mt-1 font-serif text-3xl">Get it out of your head.</h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-paper/65">
                Type or share anything into Chronos-V. You will review the interpretation before it
                touches your schedule.
              </p>
            </div>
          </div>
        </section>

        <div className="[&>section]:mt-5">
          <QuickCapture
            initialText={initialText}
            autoFocus={!initialText}
            storageScope={user.id}
            onSaved={() => void navigate({ to: "/today" })}
          />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="flex items-start gap-3 rounded-2xl border border-border bg-card/75 p-4">
            <Share2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <p className="text-xs leading-5 text-muted-foreground">
              Install Chronos-V to open Capture from your home screen or your phone’s Share menu.
            </p>
          </div>
          <div className="flex items-start gap-3 rounded-2xl border border-border bg-card/75 p-4">
            <CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <p className="text-xs leading-5 text-muted-foreground">
              Offline notes stay on this device. They are never interpreted or saved remotely until
              you review them online.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
