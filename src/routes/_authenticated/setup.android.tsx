import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Copy, Check, ExternalLink, Smartphone, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/setup/android")({
  component: AndroidSetupPage,
  head: () => ({
    meta: [
      { title: "Android OAuth setup · Chronos AI Planner" },
      { name: "description", content: "Save your Android package name, SHA-1 fingerprints and Google OAuth client IDs for Chronos AI Planner." },
      { property: "og:title", content: "Android OAuth setup · Chronos AI Planner" },
      { property: "og:description", content: "Validate and store your Android SHA-1 and Google OAuth client details." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const SHA1_RE = /^([0-9A-Fa-f]{2}:){19}[0-9A-Fa-f]{2}$/;
const CLIENT_ID_RE = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/;
const PACKAGE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

type Form = {
  package_name: string;
  debug_sha1: string;
  release_sha1: string;
  android_client_id: string;
  web_client_id: string;
  notes: string;
};

const EMPTY: Form = {
  package_name: "",
  debug_sha1: "",
  release_sha1: "",
  android_client_id: "",
  web_client_id: "",
  notes: "",
};

function normalizeSha1(raw: string) {
  const hex = raw.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
  if (hex.length !== 40) return raw.trim().toUpperCase();
  return hex.match(/.{2}/g)!.join(":");
}

function validate(form: Form) {
  const errors: Partial<Record<keyof Form, string>> = {};
  if (form.package_name && !PACKAGE_RE.test(form.package_name)) {
    errors.package_name = "Use reverse-domain form, e.g. app.chronos.planner";
  }
  if (form.debug_sha1 && !SHA1_RE.test(form.debug_sha1)) {
    errors.debug_sha1 = "Must be 40 hex characters (20 colon-separated pairs).";
  }
  if (form.release_sha1 && !SHA1_RE.test(form.release_sha1)) {
    errors.release_sha1 = "Must be 40 hex characters (20 colon-separated pairs).";
  }
  if (form.android_client_id && !CLIENT_ID_RE.test(form.android_client_id)) {
    errors.android_client_id = "Should look like 1234567890-abc123.apps.googleusercontent.com";
  }
  if (form.web_client_id && !CLIENT_ID_RE.test(form.web_client_id)) {
    errors.web_client_id = "Should look like 1234567890-abc123.apps.googleusercontent.com";
  }
  return errors;
}

function AndroidSetupPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(EMPTY);
  const [touched, setTouched] = useState(false);

  const { data } = useQuery({
    queryKey: ["android-oauth-config"],
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return null;
      const { data, error } = await supabase
        .from("android_oauth_config")
        .select("*")
        .eq("user_id", uid)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (data) {
      setForm({
        package_name: data.package_name ?? "",
        debug_sha1: data.debug_sha1 ?? "",
        release_sha1: data.release_sha1 ?? "",
        android_client_id: data.android_client_id ?? "",
        web_client_id: data.web_client_id ?? "",
        notes: data.notes ?? "",
      });
    }
  }, [data]);

  const errors = validate(form);
  const hasErrors = Object.keys(errors).length > 0;

  const save = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Not signed in");
      const { error } = await supabase
        .from("android_oauth_config")
        .upsert({ user_id: uid, ...form }, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Android OAuth details saved");
      qc.invalidateQueries({ queryKey: ["android-oauth-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function set<K extends keyof Form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  return (
    <div className="relative min-h-screen bg-background">
      <div className="absolute inset-0 paper-grain opacity-30 pointer-events-none" />
      <div className="relative mx-auto max-w-2xl px-5 py-8 md:py-12">
        <Link to="/app" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to schedule
        </Link>

        <div className="mt-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1 text-xs text-accent">
            <Smartphone className="h-3 w-3" /> Android · Google OAuth
          </div>
          <h1 className="mt-3 font-serif text-4xl md:text-5xl text-foreground leading-tight">
            Your Android <span className="text-accent italic">signing</span> details.
          </h1>
          <p className="mt-2 text-muted-foreground text-sm">
            Paste your SHA-1 fingerprints and OAuth client IDs here so they're validated and kept in one place while you configure Google Cloud.
          </p>
        </div>

        <div className="mt-8 rounded-xl border border-border bg-card px-5 py-5 space-y-5">
          <Field
            label="Android package name"
            hint="Must match applicationId in android/app/build.gradle and capacitor.config.ts."
            value={form.package_name}
            onChange={(v) => set("package_name", v)}
            error={touched ? errors.package_name : undefined}
            placeholder="app.chronos.planner"
          />
          <Field
            label="Debug SHA-1 fingerprint"
            hint="From: keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android"
            value={form.debug_sha1}
            onChange={(v) => set("debug_sha1", v)}
            onBlurFormat={(v) => set("debug_sha1", normalizeSha1(v))}
            error={touched ? errors.debug_sha1 : undefined}
            placeholder="AB:CD:12:…:9F"
            mono
          />
          <Field
            label="Release SHA-1 fingerprint"
            hint="From your release keystore, or Play Console → Setup → App signing."
            value={form.release_sha1}
            onChange={(v) => set("release_sha1", v)}
            onBlurFormat={(v) => set("release_sha1", normalizeSha1(v))}
            error={touched ? errors.release_sha1 : undefined}
            placeholder="AB:CD:12:…:9F"
            mono
          />
          <Field
            label="Android OAuth client ID"
            hint="Google Cloud → Credentials → OAuth client ID → Android."
            value={form.android_client_id}
            onChange={(v) => set("android_client_id", v.trim())}
            error={touched ? errors.android_client_id : undefined}
            placeholder="1234567890-abc123.apps.googleusercontent.com"
            mono
          />
          <Field
            label="Web OAuth client ID"
            hint="The Web client used for server-side token exchange and Gmail import."
            value={form.web_client_id}
            onChange={(v) => set("web_client_id", v.trim())}
            error={touched ? errors.web_client_id : undefined}
            placeholder="1234567890-xyz789.apps.googleusercontent.com"
            mono
          />

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea
              value={form.notes}
              maxLength={1000}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Which keystore, who holds it, tester emails added…"
            />
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button
              onClick={() => {
                setTouched(true);
                if (hasErrors) {
                  toast.error("Fix the highlighted fields first");
                  return;
                }
                save.mutate();
              }}
              disabled={save.isPending}
            >
              {save.isPending ? "Saving…" : "Save details"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Never paste the OAuth <b>client secret</b> here — it belongs in project secrets, not the database.
            </p>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-dashed border-border bg-card/40 px-5 py-4 text-sm">
          <p className="text-foreground font-medium flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-accent" /> Where these go in Google Cloud
          </p>
          <ol className="mt-2 space-y-1.5 list-decimal pl-5 text-muted-foreground">
            <li>Open <b>APIs &amp; Services → Credentials → Create credentials → OAuth client ID</b>.</li>
            <li>Application type <b>Android</b>; paste the package name and the <b>debug</b> SHA-1. Save.</li>
            <li>Repeat with the <b>release</b> SHA-1 (a second Android client, or add it to the same one).</li>
            <li>Add every tester's Google address under <b>OAuth consent screen → Test users</b>.</li>
            <li>Copy the generated client IDs back into the fields above and press Save.</li>
          </ol>
          <a
            href="https://console.cloud.google.com/apis/credentials"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-accent hover:underline mt-3"
          >
            Open Google Cloud credentials <ExternalLink className="h-3 w-3" />
          </a>
          <div className="mt-4">
            <p className="text-xs text-muted-foreground mb-1">Debug fingerprint command</p>
            <CopyRow value="keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android" />
          </div>
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          Also see the <Link to="/setup/gmail" className="text-accent hover:underline">Gmail setup guide</Link> for consent screen and scope configuration.
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  onBlurFormat,
  error,
  placeholder,
  mono,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  onBlurFormat?: (v: string) => void;
  error?: string;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        value={value}
        maxLength={255}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onBlurFormat?.(e.target.value)}
        className={`${mono ? "font-mono text-xs" : ""} ${error ? "border-destructive" : ""}`}
      />
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    toast.success("Copied");
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
      <code className="text-xs text-foreground/90 truncate flex-1">{value}</code>
      <Button size="sm" variant="ghost" onClick={copy} className="h-7 px-2">
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}
