import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { CalendarDays, ListTodo, ShieldCheck } from "lucide-react";

type OAuthApi = {
  getAuthorizationDetails: (
    id: string,
  ) => Promise<{ data: AuthorizationDetails | null; error: Error | null }>;
  approveAuthorization: (
    id: string,
  ) => Promise<{ data: RedirectResult | null; error: Error | null }>;
  denyAuthorization: (id: string) => Promise<{ data: RedirectResult | null; error: Error | null }>;
};
type RedirectResult = { redirect_url?: string; redirect_to?: string };
type AuthorizationDetails = RedirectResult & { client?: { name?: string } };

function oauthApi(): OAuthApi {
  return (supabase.auth as unknown as { oauth: OAuthApi }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    const next = location.pathname + location.searchStr;
    if (!data.session) throw redirect({ to: "/auth", search: { next } });
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauthApi().getAuthorizationDetails(authorizationId);
    if (error) throw error;
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="verolane-wash relative flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="pointer-events-none absolute inset-0 paper-grain opacity-20" />
      <div className="relative max-w-md rounded-3xl border bg-card/95 p-8 text-center shadow-[0_30px_80px_rgba(0,46,40,0.13)]">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <h1 className="mt-5 font-serif text-2xl">Connection request unavailable</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Could not load this authorization request: {String((error as Error)?.message ?? error)}
        </p>
        <Button asChild className="mt-6">
          <a href="/">Return to Chronos-V</a>
        </Button>
      </div>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientName = details?.client?.name ?? "an app";

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const api = oauthApi();
    const { data, error } = approve
      ? await api.approveAuthorization(authorization_id)
      : await api.denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  return (
    <main className="verolane-wash relative min-h-screen bg-background">
      <div className="pointer-events-none absolute inset-0 paper-grain opacity-20" />
      <div className="relative flex min-h-screen items-center justify-center px-4 py-10 sm:px-6">
        <div className="grid w-full max-w-4xl overflow-hidden rounded-3xl border border-border/80 bg-card shadow-[0_30px_80px_rgba(0,46,40,0.14)] md:grid-cols-[0.9fr_1.1fr]">
          <aside className="relative overflow-hidden bg-ink p-6 text-paper sm:p-8 md:p-10">
            <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-accent/20 blur-3xl" />
            <div className="relative flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-paper/10 ring-1 ring-paper/15">
                <img src="/favicon.png" alt="" className="h-7 w-7" />
              </span>
              <div>
                <p className="font-serif text-xl leading-none">Chronos-V</p>
                <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-paper/45">
                  Secure connection
                </p>
              </div>
            </div>

            <div className="relative mt-12">
              <ShieldCheck className="h-7 w-7 text-gold" />
              <h2 className="mt-4 font-serif text-3xl leading-tight">
                You decide who may work with your schedule.
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-paper/60">
                Review the requested access carefully. Chronos-V will only continue after your
                explicit approval.
              </p>
            </div>
          </aside>

          <section className="p-6 sm:p-8 md:p-10">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
              Authorization request
            </p>
            <h1 className="mt-3 font-serif text-3xl leading-tight text-foreground sm:text-4xl">
              Allow {clientName}?
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {clientName} is asking to work with your Chronos-V account using the following access.
            </p>

            <div className="mt-6 space-y-3">
              <div className="flex items-start gap-3 rounded-xl border bg-background p-4">
                <CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                <div>
                  <p className="text-sm font-medium">Read your schedule</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    View appointments and tasks already in Chronos-V.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-xl border bg-background p-4">
                <ListTodo className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                <div>
                  <p className="text-sm font-medium">Create schedule items</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    Add appointments and tasks to your account as you.
                  </p>
                </div>
              </div>
            </div>

            {error ? (
              <p
                role="alert"
                className="mt-4 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            ) : null}

            <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void decide(false)}
                className="flex-1"
              >
                Deny
              </Button>
              <Button disabled={busy} onClick={() => void decide(true)} className="flex-1">
                <span aria-live="polite">{busy ? "Working…" : "Allow access"}</span>
              </Button>
            </div>
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Denying leaves your Chronos-V account unchanged.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
