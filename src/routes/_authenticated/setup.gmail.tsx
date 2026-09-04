import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, Check, ExternalLink, Mail, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";

export const Route = createFileRoute("/_authenticated/setup/gmail")({
  component: GmailSetupPage,
});

const PREVIEW_REDIRECT =
  "https://id-preview--3efdbf41-41b9-4a36-a987-83eec491b4cd.lovable.app/api/gmail/callback";
const PRODUCTION_REDIRECT = "https://YOUR-PUBLISHED-DOMAIN/api/gmail/callback";
const SCOPES = "https://www.googleapis.com/auth/gmail.readonly";

function GmailSetupPage() {
  return (
    <div className="verolane-wash relative min-h-screen bg-background">
      <div className="pointer-events-none absolute inset-0 paper-grain opacity-20" />
      <div className="relative mx-auto max-w-[1180px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <WorkspaceHeader
          eyebrow="Gmail connection setup"
          title={
            <>
              Prepare Gmail for <span className="text-accent italic">trusted testing.</span>
            </>
          }
          description="Complete this one-time Google Cloud setup so each tester can privately connect their own inbox before public verification."
          action={
            <Button asChild variant="outline" className="bg-card/80">
              <Link to="/inbox">
                <Mail className="mr-1.5 h-4 w-4" /> Open Smart Inbox
              </Link>
            </Button>
          }
        />

        <div className="mt-8 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-6">
            <ol className="space-y-6">
              <Step n={1} title="Create a Google Cloud project">
                <p>
                  Open the Google Cloud Console and create (or pick) a project to own these
                  credentials.
                </p>
                <LinkOut href="https://console.cloud.google.com/projectcreate">
                  Create a project
                </LinkOut>
              </Step>

              <Step n={2} title="Enable the Gmail API">
                <p>
                  In your project, go to <b>APIs &amp; Services → Library</b> and enable the Gmail
                  API.
                </p>
                <LinkOut href="https://console.cloud.google.com/apis/library/gmail.googleapis.com">
                  Enable Gmail API
                </LinkOut>
              </Step>

              <Step n={3} title="Configure the OAuth consent screen">
                <ul className="list-disc space-y-1.5 pl-5">
                  <li>
                    Go to <b>APIs &amp; Services → OAuth consent screen</b>.
                  </li>
                  <li>
                    User type: <b>External</b>. Publishing status: <b>Testing</b> (until Google
                    verifies).
                  </li>
                  <li>App name, support email, developer email — fill these in.</li>
                  <li>
                    Authorized domains: add <code className="text-accent">lovable.app</code> (and
                    your custom domain once published).
                  </li>
                </ul>
                <LinkOut href="https://console.cloud.google.com/apis/credentials/consent">
                  Open consent screen
                </LinkOut>
              </Step>

              <Step n={4} title="Add the Gmail scope">
                <p>
                  On the consent screen <b>Scopes</b> step, add this scope:
                </p>
                <CopyRow value={SCOPES} />
                <p className="mt-1 text-xs text-muted-foreground">
                  This is a <b>restricted</b> scope. Testers can use it freely; full public launch
                  requires Google's verification + a CASA security assessment.
                </p>
              </Step>

              <Step n={5} title="Add Test Users">
                <ul className="list-disc space-y-1.5 pl-5">
                  <li>
                    Still in the consent screen, open the <b>Test users</b> section.
                  </li>
                  <li>
                    Click <b>Add users</b> and paste the Gmail addresses of every tester (up to
                    100).
                  </li>
                  <li>
                    Each tester must accept the "unverified app" warning the first time they connect
                    — that's expected during Testing.
                  </li>
                </ul>
              </Step>

              <Step n={6} title="Create OAuth Client credentials">
                <ul className="list-disc space-y-1.5 pl-5">
                  <li>
                    Go to{" "}
                    <b>APIs &amp; Services → Credentials → Create credentials → OAuth client ID</b>.
                  </li>
                  <li>
                    Application type: <b>Web application</b>.
                  </li>
                  <li>
                    Add these <b>Authorized redirect URIs</b>:
                  </li>
                </ul>
                <CopyRow value={PREVIEW_REDIRECT} label="Preview" />
                <CopyRow value={PRODUCTION_REDIRECT} label="Production (after publish)" />
                <LinkOut href="https://console.cloud.google.com/apis/credentials">
                  Open credentials
                </LinkOut>
              </Step>

              <Step n={7} title="Send testers the Connect link">
                <p>
                  Once the Client ID &amp; Secret are saved in this app, each tester signs in and
                  clicks <b>Connect Gmail</b> on their schedule. They'll go through Google's consent
                  screen with their own account — and Smart Inbox will suggest appointments from
                  <i> their</i> inbox for approval.
                </p>
              </Step>
            </ol>

            <div className="rounded-2xl border border-dashed border-border bg-card/60 px-5 py-4 text-sm">
              <p className="font-medium text-foreground">Going live for everyone?</p>
              <p className="mt-1 text-muted-foreground">
                When you're ready to drop the 100-tester cap, submit the app for Google's OAuth
                verification. Allow 4–6 weeks; a CASA security assessment is required for the
                <code> gmail.readonly</code> scope.
              </p>
            </div>
          </div>

          <aside className="rounded-2xl bg-ink p-6 text-paper shadow-[0_24px_55px_rgba(0,46,40,0.14)] xl:sticky xl:top-8">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-paper/10 text-gold">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <h2 className="mt-5 font-serif text-2xl">Before you begin</h2>
            <p className="mt-2 text-sm leading-relaxed text-paper/65">
              This connection is deliberately narrow and keeps every tester in control.
            </p>
            <ul className="mt-5 space-y-4 text-sm text-paper/75">
              <li className="border-t border-paper/10 pt-4">
                Chronos-V requests read-only Gmail access. It cannot send, edit, or delete email.
              </li>
              <li className="border-t border-paper/10 pt-4">
                Every tester connects their own Google account and approves the permission directly
                with Google.
              </li>
              <li className="border-t border-paper/10 pt-4">
                Smart Inbox proposes likely schedule items. Nothing joins the timeline until the
                user approves it.
              </li>
            </ul>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-2xl border border-border bg-card/90 px-5 py-5 shadow-[0_18px_45px_rgba(0,46,40,0.04)] sm:px-6">
      <div className="flex items-baseline gap-3">
        <span className="font-serif text-accent text-2xl">{n}</span>
        <h2 className="font-serif text-xl text-foreground">{title}</h2>
      </div>
      <div className="mt-3 text-sm text-foreground/85 space-y-2">{children}</div>
    </li>
  );
}

function LinkOut({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="mt-1 inline-flex items-center gap-1 text-sm text-accent hover:underline"
    >
      {children} <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function CopyRow({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    toast.success("Copied");
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="mt-1">
      {label && <p className="mb-1 text-xs text-muted-foreground">{label}</p>}
      <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
        <code className="flex-1 truncate text-xs text-foreground/90">{value}</code>
        <Button size="sm" variant="ghost" onClick={copy} className="h-7 px-2">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}
