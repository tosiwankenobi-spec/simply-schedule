import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{ data: AuthorizationDetails | null; error: Error | null }>;
  approveAuthorization: (id: string) => Promise<{ data: RedirectResult | null; error: Error | null }>;
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
    <main className="flex min-h-screen items-center justify-center px-6 text-center">
      <p className="max-w-md text-sm text-muted-foreground">
        Could not load this authorization request: {String((error as Error)?.message ?? error)}
      </p>
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
    <main className="relative min-h-screen bg-background">
      <div className="absolute inset-0 paper-grain opacity-40 pointer-events-none" />
      <div className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
        <div className="mb-8 flex items-center gap-2 text-foreground">
          <img src="/favicon.png" alt="" className="h-7 w-7" />
          <span className="font-serif text-xl">Chronos-V</span>
        </div>
        <h1 className="font-serif text-3xl leading-tight text-foreground">
          Connect {clientName} to your schedule
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {clientName} will be able to read and create appointments and tasks in Chronos-V as you.
        </p>
        {error ? (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="mt-8 flex gap-3">
          <Button
            disabled={busy}
            onClick={() => void decide(true)}
            className="flex-1 bg-foreground text-background hover:bg-foreground/90"
          >
            Approve
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void decide(false)} className="flex-1">
            Deny
          </Button>
        </div>
      </div>
    </main>
  );
}
