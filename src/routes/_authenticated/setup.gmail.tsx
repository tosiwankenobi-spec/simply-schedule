import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Copy, Check, ExternalLink, Mail } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/setup/gmail")({
  component: GmailSetupPage,
});

const PREVIEW_REDIRECT = "https://id-preview--3efdbf41-41b9-4a36-a987-83eec491b4cd.lovable.app/api/gmail/callback";
const PRODUCTION_REDIRECT = "https://YOUR-PUBLISHED-DOMAIN/api/gmail/callback";
const SCOPES = "https://www.googleapis.com/auth/gmail.readonly";

function GmailSetupPage() {
  return (
    <div className="relative min-h-screen bg-background">
      <div className="absolute inset-0 paper-grain opacity-30 pointer-events-none" />
      <div className="relative mx-auto max-w-2xl px-5 py-8 md:py-12">
        <Link to="/app" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to schedule
        </Link>

        <div className="mt-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1 text-xs text-accent">
            <Mail className="h-3 w-3" /> Gmail · Google OAuth setup
          </div>
          <h1 className="mt-3 font-serif text-4xl md:text-5xl text-foreground leading-tight">
            Onboard your <span className="text-accent italic">testers</span>.
          </h1>
          <p className="mt-2 text-muted-foreground text-sm">
            A one-time setup in Google Cloud so each user can connect their own Gmail before the app is publicly verified.
          </p>
        </div>

        <ol className="mt-10 space-y-6">
          <Step n={1} title="Create a Google Cloud project">
            <p>Open the Google Cloud Console and create (or pick) a project to own these credentials.</p>
            <LinkOut href="https://console.cloud.google.com/projectcreate">Create a project</LinkOut>
          </Step>

          <Step n={2} title="Enable the Gmail API">
            <p>In your project, go to <b>APIs &amp; Services → Library</b> and enable the Gmail API.</p>
            <LinkOut href="https://console.cloud.google.com/apis/library/gmail.googleapis.com">Enable Gmail API</LinkOut>
          </Step>

          <Step n={3} title="Configure the OAuth consent screen">
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Go to <b>APIs &amp; Services → OAuth consent screen</b>.</li>
              <li>User type: <b>External</b>. Publishing status: <b>Testing</b> (until Google verifies).</li>
              <li>App name, support email, developer email — fill these in.</li>
              <li>Authorized domains: add <code className="text-accent">lovable.app</code> (and your custom domain once published).</li>
            </ul>
            <LinkOut href="https://console.cloud.google.com/apis/credentials/consent">Open consent screen</LinkOut>
          </Step>

          <Step n={4} title="Add the Gmail scope">
            <p>On the consent screen <b>Scopes</b> step, add this scope:</p>
            <CopyRow value={SCOPES} />
            <p className="text-xs text-muted-foreground mt-1">
              This is a <b>restricted</b> scope. Testers can use it freely; full public launch requires Google's verification + a CASA security assessment.
            </p>
          </Step>

          <Step n={5} title="Add Test Users">
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Still in the consent screen, open the <b>Test users</b> section.</li>
              <li>Click <b>Add users</b> and paste the Gmail addresses of every tester (up to 100).</li>
              <li>Each tester must accept the "unverified app" warning the first time they connect — that's expected during Testing.</li>
            </ul>
          </Step>

          <Step n={6} title="Create OAuth Client credentials">
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Go to <b>APIs &amp; Services → Credentials → Create credentials → OAuth client ID</b>.</li>
              <li>Application type: <b>Web application</b>.</li>
              <li>Add these <b>Authorized redirect URIs</b>:</li>
            </ul>
            <CopyRow value={PREVIEW_REDIRECT} label="Preview" />
            <CopyRow value={PRODUCTION_REDIRECT} label="Production (after publish)" />
            <LinkOut href="https://console.cloud.google.com/apis/credentials">Open credentials</LinkOut>
          </Step>

          <Step n={7} title="Send testers the Connect link">
            <p>Once the Client ID &amp; Secret are saved in this app, each tester signs in and clicks <b>Connect Gmail</b> on their schedule. They'll go through Google's consent screen with their own account — and Smart Inbox will suggest appointments from <i>their</i> inbox for approval.</p>
          </Step>
        </ol>

        <div className="mt-12 rounded-xl border border-dashed border-border bg-card/40 px-5 py-4 text-sm">
          <p className="text-foreground font-medium">Going live for everyone?</p>
          <p className="mt-1 text-muted-foreground">
            When you're ready to drop the 100-tester cap, submit the app for Google's OAuth verification. Allow 4–6 weeks; a CASA security assessment is required for the <code>gmail.readonly</code> scope.
          </p>
        </div>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-xl border border-border bg-card px-5 py-5">
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
    <a href={href} target="_blank" rel="noreferrer"
       className="inline-flex items-center gap-1 text-sm text-accent hover:underline mt-1">
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
      {label && <p className="text-xs text-muted-foreground mb-1">{label}</p>}
      <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
        <code className="text-xs text-foreground/90 truncate flex-1">{value}</code>
        <Button size="sm" variant="ghost" onClick={copy} className="h-7 px-2">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}
