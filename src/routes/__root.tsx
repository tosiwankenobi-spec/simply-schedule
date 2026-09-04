import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  CalendarDays,
  CloudOff,
  Home,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  WifiOff,
} from "lucide-react";

import appCss from "../styles.css?url";
import "@fontsource/fraunces/400.css";
import "@fontsource/fraunces/500.css";
import "@fontsource/fraunces/600.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <RecoveryLayout eyebrow="Page not found" icon={CalendarDays}>
      <p className="text-sm font-semibold uppercase tracking-[0.22em] text-ember">404</p>
      <h1 className="mt-3 max-w-lg font-serif text-4xl leading-tight text-ink sm:text-5xl">
        This page slipped off the schedule.
      </h1>
      <p className="mt-4 max-w-md text-sm leading-6 text-muted-foreground sm:text-base">
        The link may be old, or the page may have moved. Your plans and saved information are still
        safe.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link
          to="/"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-ink px-5 text-sm font-semibold text-paper shadow-lg shadow-ink/10 transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:ring-offset-2"
        >
          <Home className="h-4 w-4" /> Return to Chronos-V
        </Link>
        <button
          type="button"
          onClick={() => window.history.back()}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 text-sm font-semibold text-ink transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:ring-offset-2"
        >
          <ArrowLeft className="h-4 w-4" /> Go back
        </button>
      </div>
    </RecoveryLayout>
  );
}

function RecoveryLayout({
  children,
  eyebrow,
  icon: Icon,
}: {
  children: ReactNode;
  eyebrow: string;
  icon: typeof CalendarDays;
}) {
  return (
    <main className="verolane-wash relative isolate flex min-h-screen items-center overflow-hidden bg-paper px-4 py-10 sm:px-8">
      <div className="paper-grain absolute inset-0 -z-10 opacity-35" />
      <div className="absolute -right-20 -top-24 -z-10 h-72 w-72 rounded-full bg-leaf/10 blur-3xl" />
      <div className="mx-auto grid w-full max-w-5xl overflow-hidden rounded-[2rem] border border-border/80 bg-card/95 shadow-[0_30px_90px_rgba(0,46,40,0.12)] lg:grid-cols-[0.8fr_1.2fr]">
        <div className="relative hidden min-h-[34rem] flex-col justify-between overflow-hidden bg-ink p-10 text-paper lg:flex">
          <div className="absolute -right-20 top-20 h-64 w-64 rounded-full border border-paper/10" />
          <div className="absolute -right-8 top-32 h-40 w-40 rounded-full border border-paper/10" />
          <div>
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-paper/10 ring-1 ring-paper/15">
                <img src="/favicon.png" alt="" className="h-7 w-7" />
              </span>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-paper/55">
                  Verolane
                </p>
                <p className="font-serif text-xl">Chronos-V</p>
              </div>
            </div>
            <p className="mt-16 text-xs font-semibold uppercase tracking-[0.2em] text-leaf">
              {eyebrow}
            </p>
            <p className="mt-4 max-w-xs font-serif text-3xl leading-snug">
              Your day is still here. We&apos;ll help you find your way back.
            </p>
          </div>
          <p className="flex items-center gap-2 text-xs text-paper/55">
            <ShieldCheck className="h-4 w-4 text-leaf" /> Your schedule remains private and
            protected
          </p>
        </div>

        <section className="flex min-h-[30rem] flex-col justify-center px-6 py-12 sm:px-12 lg:px-16">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-ink text-paper">
              <Icon className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Verolane
              </p>
              <p className="font-serif text-lg leading-none text-ink">Chronos-V</p>
            </div>
          </div>
          {children}
        </section>
      </div>
    </main>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <RecoveryLayout eyebrow="A temporary interruption" icon={CloudOff}>
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-secondary text-ink">
        <Sparkles className="h-5 w-5" />
      </span>
      <h1 className="mt-5 max-w-lg font-serif text-4xl leading-tight text-ink sm:text-5xl">
        Your schedule needs a moment.
      </h1>
      <p className="mt-4 max-w-md text-sm leading-6 text-muted-foreground sm:text-base">
        We couldn&apos;t finish loading this page. Try once more—your saved plans have not been
        changed.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-ink px-5 text-sm font-semibold text-paper shadow-lg shadow-ink/10 transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:ring-offset-2"
        >
          <RefreshCw className="h-4 w-4" /> Try again
        </button>
        <a
          href="/"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 text-sm font-semibold text-ink transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:ring-offset-2"
        >
          <Home className="h-4 w-4" /> Return home
        </a>
      </div>
    </RecoveryLayout>
  );
}

function NetworkStatusNotice() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    const updateStatus = () => setIsOffline(!navigator.onLine);
    updateStatus();
    window.addEventListener("online", updateStatus);
    window.addEventListener("offline", updateStatus);
    return () => {
      window.removeEventListener("online", updateStatus);
      window.removeEventListener("offline", updateStatus);
    };
  }, []);

  return isOffline ? (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 top-3 z-[100] mx-auto flex max-w-lg items-start gap-3 rounded-2xl border border-gold/35 bg-ink px-4 py-3 text-paper shadow-2xl shadow-ink/20 sm:items-center"
    >
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-paper/10 sm:mt-0">
        <WifiOff className="h-4 w-4 text-gold" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold">You&apos;re offline</p>
        <p className="mt-0.5 text-xs leading-5 text-paper/65">
          Reconnect before making changes so your schedule stays in sync.
        </p>
      </div>
    </div>
  ) : null;
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Chronos-V — your AI schedule planner" },
      {
        name: "description",
        content: "Plan appointments by typing, pasting, or speaking. AI fills in the rest.",
      },
      { property: "og:title", content: "Chronos-V — your AI schedule planner" },
      {
        property: "og:description",
        content: "Plan appointments by typing, pasting, or speaking. AI fills in the rest.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "theme-color", content: "#002E28" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Chronos-V" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient, router]);

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <NetworkStatusNotice />
      <Toaster />
    </QueryClientProvider>
  );
}
