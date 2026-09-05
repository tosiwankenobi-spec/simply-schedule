import { useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CalendarArrowUp,
  CalendarDays,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/setup/outlook")({
  component: OutlookSetupPage,
  head: () => ({
    meta: [
      { title: "Microsoft Outlook setup · Chronos-V" },
      {
        name: "description",
        content:
          "Prepare a private, per-user Microsoft Outlook connection without exposing OAuth tokens to Chronos-V.",
      },
    ],
  }),
});

const CALLBACK_URL = "https://connector-gateway.lovable.dev/api/v1/app-users/oauth2/callback";

const SETUP_STEPS = [
  {
    title: "Register Chronos-V in Microsoft Entra",
    description:
      "Create an app registration for personal, work, and school Microsoft accounts, then add the gateway callback below as a web redirect URI.",
  },
  {
    title: "Start with calendar read access",
    description:
      "Use delegated User.Read, Calendars.Read, and offline_access permissions first. This is enough to build a trustworthy read-only timeline connection.",
  },
  {
    title: "Create an Outlook app-user client in Lovable",
    description:
      "Choose App user connector—not a shared App + chat connection—so every signed-in person authorizes only their own Microsoft account.",
  },
  {
    title: "Link the client to this project",
    description:
      "Once linked, Chronos-V can add the in-app connect and disconnect flow. Until then, no Microsoft permission is requested and no account is accessed.",
  },
] as const;

function OutlookSetupPage() {
  const [copied, setCopied] = useState(false);

  async function copyCallback() {
    try {
      await navigator.clipboard.writeText(CALLBACK_URL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
      toast.success("Callback URL copied");
    } catch {
      toast.error("Couldn't copy automatically. Select the URL and copy it manually.");
    }
  }

  return (
    <div className="verolane-wash relative min-h-screen bg-background">
      <div className="pointer-events-none absolute inset-0 paper-grain opacity-20" />
      <div className="relative mx-auto max-w-[1180px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <WorkspaceHeader
          eyebrow="Microsoft Outlook"
          title={
            <>
              Connect each account, <span className="text-accent italic">privately.</span>
            </>
          }
          description="Prepare a per-user Outlook connection for live calendar and Smart Inbox access. This page does not connect an account or request any Microsoft permission."
          action={
            <Button asChild variant="outline" className="min-h-11 bg-card/80">
              <Link to="/calendar-import">
                <CalendarArrowUp className="mr-1.5 h-4 w-4" /> Import Outlook file
              </Link>
            </Button>
          }
        />

        <section className="relative mt-6 overflow-hidden rounded-3xl bg-ink p-5 text-paper shadow-[0_22px_55px_rgba(0,46,40,0.14)] sm:p-7">
          <div className="pointer-events-none absolute -right-14 -top-20 h-56 w-56 rounded-full border border-paper/10" />
          <div className="relative grid gap-5 md:grid-cols-[auto_1fr_auto] md:items-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-paper/10 text-leaf ring-1 ring-paper/15">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-leaf">
                  Secure foundation
                </p>
                <Badge className="border-paper/15 bg-paper/10 text-paper hover:bg-paper/10">
                  Builder setup required
                </Badge>
              </div>
              <h2 className="mt-1 font-serif text-2xl">Tokens stay outside the application.</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-paper/60">
                Lovable's connector gateway stores and refreshes Microsoft tokens. Chronos-V
                receives calendar or mail results only after the signed-in user grants access.
              </p>
            </div>
            <Button
              asChild
              variant="ghost"
              className="min-h-11 bg-paper text-ink hover:bg-paper/90"
            >
              <a href="https://lovable.dev/dashboard?connectors=" target="_blank" rel="noreferrer">
                Open connectors <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </Button>
          </div>
        </section>

        <div className="mt-8 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="rounded-2xl bg-card/90 shadow-[0_18px_45px_rgba(0,46,40,0.04)]">
            <CardHeader>
              <CardTitle>Connection checklist</CardTitle>
              <CardDescription>
                Complete these builder steps before adding the user-facing Connect Outlook button.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-5">
                {SETUP_STEPS.map((step, index) => (
                  <li key={step.title} className="grid grid-cols-[2.25rem_1fr] gap-3">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-secondary font-serif text-sm text-ink">
                      {index + 1}
                    </span>
                    <div>
                      <h3 className="font-medium text-foreground">{step.title}</h3>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        {step.description}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="mt-6 rounded-2xl border border-border bg-secondary/25 p-4">
                <p className="text-sm font-medium text-foreground">Gateway callback URL</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Add this exact URL to the Microsoft app registration.
                </p>
                <div className="mt-3 flex min-w-0 items-center gap-2 rounded-xl border bg-background p-2">
                  <code className="min-w-0 flex-1 select-all overflow-x-auto px-2 text-xs text-foreground">
                    {CALLBACK_URL}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-11 w-11 shrink-0"
                    onClick={() => void copyCallback()}
                    aria-label="Copy Microsoft callback URL"
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Button asChild variant="outline" className="min-h-11">
                  <a
                    href="https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Microsoft app registration <ExternalLink className="ml-2 h-4 w-4" />
                  </a>
                </Button>
                <Button asChild variant="ghost" className="min-h-11">
                  <a
                    href="https://docs.lovable.dev/integrations/app-user-connectors"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Lovable app-user guide <ArrowRight className="ml-2 h-4 w-4" />
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="rounded-2xl bg-card/90 shadow-[0_18px_45px_rgba(0,46,40,0.04)]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <KeyRound className="h-5 w-5" /> Least-privilege plan
                </CardTitle>
                <CardDescription>Add access only when a finished feature needs it.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <PermissionRow
                  icon={<CalendarDays className="h-4 w-4" />}
                  title="Calendar foundation"
                  scopes="User.Read · Calendars.Read · offline_access"
                  note="Read events and keep the connection refreshed."
                />
                <PermissionRow
                  icon={<CalendarDays className="h-4 w-4" />}
                  title="Two-way calendar"
                  scopes="Calendars.ReadWrite"
                  note="Add only when Outlook conflict-safe writes are ready."
                />
                <PermissionRow
                  icon={<Mail className="h-4 w-4" />}
                  title="Smart Inbox"
                  scopes="Mail.Read"
                  note="Add separately when Outlook suggestions are ready. Mail.Send is not required."
                />
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-dashed bg-card/70">
              <CardHeader>
                <CardTitle>Use Outlook today</CardTitle>
                <CardDescription>
                  Export an `.ics` file from Outlook and preview it locally. The raw file never
                  leaves your device, and importing creates a private one-way snapshot.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild className="min-h-11 w-full">
                  <Link to="/calendar-import">
                    Import Outlook calendar <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function PermissionRow({
  icon,
  title,
  scopes,
  note,
}: {
  icon: ReactNode;
  title: string;
  scopes: string;
  note: string;
}) {
  return (
    <div className="rounded-xl border p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <span className="text-accent">{icon}</span>
        {title}
      </div>
      <code className="mt-2 block text-xs text-ink">{scopes}</code>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{note}</p>
    </div>
  );
}
