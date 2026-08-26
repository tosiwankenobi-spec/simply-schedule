import { createFileRoute, Link } from "@tanstack/react-router";
import React, { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, Copy, Check, ExternalLink, Smartphone, AlertCircle, ShieldCheck, X, Terminal, Wrench } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/setup/android")({
  component: AndroidSetupPage,
  head: () => ({
    meta: [
      { title: "Android OAuth setup · V-Chronos" },
      { name: "description", content: "Save your Android package name, SHA-1 fingerprints and Google OAuth client IDs for V-Chronos." },
      { property: "og:title", content: "Android OAuth setup · V-Chronos" },
      { property: "og:description", content: "Validate and store your Android SHA-1 and Google OAuth client details." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const SHA1_RE = /^([0-9A-Fa-f]{2}:){19}[0-9A-Fa-f]{2}$/;
const CLIENT_ID_RE = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/;
const PACKAGE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

type KeystoreType = "debug" | "release" | "play";

type Form = {
  package_name: string;
  debug_sha1: string;
  release_sha1: string;
  play_sha1: string;
  android_client_id: string;
  web_client_id: string;
  notes: string;
};

const EMPTY: Form = {
  package_name: "app.chronos.planner",
  debug_sha1: "",
  release_sha1: "",
  play_sha1: "",
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
  if (form.play_sha1 && !SHA1_RE.test(form.play_sha1)) {
    errors.play_sha1 = "Must be 40 hex characters (20 colon-separated pairs).";
  }
  if (form.android_client_id && !CLIENT_ID_RE.test(form.android_client_id)) {
    errors.android_client_id = "Should look like 1234567890-abc123.apps.googleusercontent.com";
  }
  if (form.web_client_id && !CLIENT_ID_RE.test(form.web_client_id)) {
    errors.web_client_id = "Should look like 1234567890-abc123.apps.googleusercontent.com";
  }
  return errors;
}

type CheckResult = { label: string; ok: boolean; detail: string };

function runOAuthChecks(form: Form): CheckResult[] {
  const results: CheckResult[] = [];
  const push = (label: string, ok: boolean, detail: string) => results.push({ label, ok, detail });

  push(
    "Package name",
    !!form.package_name && PACKAGE_RE.test(form.package_name),
    !form.package_name
      ? "Missing. Add the applicationId used in capacitor.config.ts / build.gradle."
      : PACKAGE_RE.test(form.package_name)
        ? form.package_name
        : "Invalid format — use reverse-domain style, e.g. app.chronos.planner.",
  );

  push(
    "Debug SHA-1",
    SHA1_RE.test(form.debug_sha1),
    !form.debug_sha1
      ? "Missing. Run the keytool debug command below and paste the SHA1 line."
      : SHA1_RE.test(form.debug_sha1)
        ? "Valid 20-byte fingerprint."
        : "Not a valid SHA-1 — expected 40 hex characters as 20 colon-separated pairs.",
  );

  push(
    "Release SHA-1",
    SHA1_RE.test(form.release_sha1),
    !form.release_sha1
      ? "Missing. Optional for local testing, required for Play Store builds using your upload keystore."
      : SHA1_RE.test(form.release_sha1)
        ? "Valid 20-byte fingerprint."
        : "Not a valid SHA-1 — expected 40 hex characters as 20 colon-separated pairs.",
  );

  push(
    "Play App Signing SHA-1",
    SHA1_RE.test(form.play_sha1),
    !form.play_sha1
      ? "Missing. Optional if you self-sign; required once Google re-signs your app in Play."
      : SHA1_RE.test(form.play_sha1)
        ? "Valid 20-byte fingerprint."
        : "Not a valid SHA-1 — expected 40 hex characters as 20 colon-separated pairs.",
  );

  const shaValues = [form.debug_sha1, form.release_sha1, form.play_sha1].filter((v) => SHA1_RE.test(v));
  const uniqueSha = new Set(shaValues);
  if (shaValues.length > 1) {
    push(
      "Fingerprints are distinct",
      uniqueSha.size === shaValues.length,
      uniqueSha.size === shaValues.length
        ? "Every provided SHA-1 is different, as expected for separate certificates."
        : "Two or more SHA-1 values are identical — you probably pasted the same fingerprint twice.",
    );
  }

  push(
    "Android client ID",
    CLIENT_ID_RE.test(form.android_client_id),
    !form.android_client_id
      ? "Missing. Create an OAuth client of type Android in Google Cloud."
      : CLIENT_ID_RE.test(form.android_client_id)
        ? "Well-formed Google client ID."
        : "Should end in .apps.googleusercontent.com, e.g. 1234567890-abc123.apps.googleusercontent.com.",
  );

  push(
    "Web client ID",
    CLIENT_ID_RE.test(form.web_client_id),
    !form.web_client_id
      ? "Missing. Needed for server-side token exchange and Gmail import."
      : CLIENT_ID_RE.test(form.web_client_id)
        ? "Well-formed Google client ID."
        : "Should end in .apps.googleusercontent.com.",
  );

  const bothIds = CLIENT_ID_RE.test(form.android_client_id) && CLIENT_ID_RE.test(form.web_client_id);
  if (bothIds) {
    push(
      "Client IDs are distinct",
      form.android_client_id !== form.web_client_id,
      form.android_client_id !== form.web_client_id
        ? "Android and Web clients are separate, as required."
        : "Same ID in both fields — Android sign-in needs its own Android-type client.",
    );
    const projA = form.android_client_id.split("-")[0];
    const projW = form.web_client_id.split("-")[0];
    push(
      "Same Google project",
      projA === projW,
      projA === projW
        ? "Both clients come from the same Google Cloud project."
        : "The two client IDs come from different projects — sign-in will fail with an audience mismatch.",
    );
  }

  push(
    "No client secret pasted",
    !/GOCSPX-/i.test(Object.values(form).join(" ")),
    /GOCSPX-/i.test(Object.values(form).join(" "))
      ? "A Google client secret was detected. Remove it — secrets must never be stored here."
      : "No secret-looking value found in these fields.",
  );

  return results;
}

const KEYSTORE_GUIDES: Record<
  KeystoreType,
  { title: string; body: React.ReactNode; command?: string; fieldKey: keyof Form; label: string }
> = {
  debug: {
    title: "Debug keystore",
    fieldKey: "debug_sha1",
    label: "Debug SHA-1 fingerprint",
    body: (
      <>
        Android Studio creates this automatically the first time you build. The password is always{" "}
        <code>android</code>. Copy the line starting with <code>SHA1:</code> into the Debug SHA-1 field.
      </>
    ),
    command: "keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android",
  },
  release: {
    title: "Release keystore",
    fieldKey: "release_sha1",
    label: "Release SHA-1 fingerprint",
    body: (
      <>
        Use your own upload keystore. Create it once and back it up — losing it means you cannot ship updates. Paste
        the <code>SHA1:</code> value into the Release SHA-1 field.
      </>
    ),
    command: "keytool -list -v -keystore release.keystore -alias upload",
  },
  play: {
    title: "Play App Signing",
    fieldKey: "play_sha1",
    label: "Play App Signing SHA-1 fingerprint",
    body: (
      <>
        Google re-signs your app before distribution. Copy the SHA-1 from{" "}
        <b>Play Console → your app → Test and release → Setup → App signing</b> into the Play App Signing SHA-1
        field. Register this fingerprint on the same Android OAuth client in Google Cloud.
      </>
    ),
  },
};

function AndroidSetupPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(EMPTY);
  const [touched, setTouched] = useState(false);
  const [checks, setChecks] = useState<CheckResult[] | null>(null);
  const [keystore, setKeystore] = useState<KeystoreType>("debug");
  const fieldRefs: Record<KeystoreType, React.RefObject<HTMLInputElement | null>> = {
    debug: useRef<HTMLInputElement>(null),
    release: useRef<HTMLInputElement>(null),
    play: useRef<HTMLInputElement>(null),
  };

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
        package_name: data.package_name || EMPTY.package_name,
        debug_sha1: data.debug_sha1 ?? "",
        release_sha1: data.release_sha1 ?? "",
        play_sha1: data.play_sha1 ?? "",
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

  function handleKeystoreChange(next: KeystoreType) {
    setKeystore(next);
    const ref = fieldRefs[next];
    ref.current?.focus();
    ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const guide = KEYSTORE_GUIDES[keystore];

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
            Paste your SHA-1 fingerprints and OAuth client IDs here so they're validated and kept in one place while
            you configure Google Cloud.
          </p>
        </div>

        <div className="mt-8 rounded-xl border border-border bg-card px-5 py-5">
          <p className="text-sm font-medium text-foreground">1. Choose the certificate you are configuring</p>
          <Tabs value={keystore} onValueChange={(v) => handleKeystoreChange(v as KeystoreType)} className="mt-3">
            <TabsList className="w-full grid grid-cols-3">
              <TabsTrigger value="debug">Debug</TabsTrigger>
              <TabsTrigger value="release">Release</TabsTrigger>
              <TabsTrigger value="play">Play App Signing</TabsTrigger>
            </TabsList>
            <TabsContent value={keystore} className="mt-4">
              <div className="rounded-lg border border-border bg-background px-4 py-3 text-sm">
                <p className="font-medium text-foreground flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-accent" /> {guide.title}
                </p>
                <p className="mt-2 text-muted-foreground text-xs">{guide.body}</p>
                {guide.command ? (
                  <div className="mt-3">
                    <p className="text-xs text-muted-foreground mb-1">Command to run</p>
                    <CopyRow value={guide.command} />
                  </div>
                ) : null}
                <p className="mt-3 text-xs text-accent">
                  Paste the resulting SHA-1 into the <b>{guide.label}</b> field below.
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <div className="mt-6 rounded-xl border border-border bg-card px-5 py-5 space-y-5">
          <Field
            label="Android package name"
            hint="Must match applicationId in android/app/build.gradle and capacitor.config.ts."
            value={form.package_name}
            onChange={(v) => set("package_name", v)}
            error={touched ? errors.package_name : undefined}
            placeholder="app.chronos.planner"
          />
          <Field
            ref={fieldRefs.debug}
            label="Debug SHA-1 fingerprint"
            hint="From: keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android"
            value={form.debug_sha1}
            onChange={(v) => set("debug_sha1", v)}
            onBlurFormat={(v) => set("debug_sha1", normalizeSha1(v))}
            error={touched ? errors.debug_sha1 : undefined}
            placeholder="AB:CD:12:…:9F"
            mono
            active={keystore === "debug"}
          />
          <Field
            ref={fieldRefs.release}
            label="Release SHA-1 fingerprint"
            hint="From your release keystore, or Play Console → Setup → App signing."
            value={form.release_sha1}
            onChange={(v) => set("release_sha1", v)}
            onBlurFormat={(v) => set("release_sha1", normalizeSha1(v))}
            error={touched ? errors.release_sha1 : undefined}
            placeholder="AB:CD:12:…:9F"
            mono
            active={keystore === "release"}
          />
          <Field
            ref={fieldRefs.play}
            label="Play App Signing SHA-1 fingerprint"
            hint="From Play Console → Test and release → Setup → App signing. Only needed once Google re-signs your app."
            value={form.play_sha1}
            onChange={(v) => set("play_sha1", v)}
            onBlurFormat={(v) => set("play_sha1", normalizeSha1(v))}
            error={touched ? errors.play_sha1 : undefined}
            placeholder="AB:CD:12:…:9F"
            mono
            active={keystore === "play"}
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

          <div className="flex flex-wrap items-center gap-3 pt-1">
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
            <Button
              variant="outline"
              onClick={() => {
                const results = runOAuthChecks(form);
                setChecks(results);
                const failed = results.filter((r) => !r.ok).length;
                if (failed === 0) toast.success("All Google OAuth checks passed");
                else toast.error(`${failed} check${failed === 1 ? "" : "s"} need attention`);
              }}
            >
              <ShieldCheck className="h-4 w-4 mr-1.5" /> Test Google OAuth
            </Button>
            <p className="text-xs text-muted-foreground">
              Never paste the OAuth <b>client secret</b> here — it belongs in project secrets, not the database.
            </p>
          </div>

          {checks ? (
            <div className="rounded-lg border border-border bg-background px-4 py-3">
              <p className="text-sm font-medium text-foreground">
                Check results · {checks.filter((c) => c.ok).length}/{checks.length} passed
              </p>
              <ul className="mt-2.5 space-y-2">
                {checks.map((c) => (
                  <li key={c.label} className="flex gap-2.5 text-sm">
                    {c.ok ? (
                      <Check className="h-4 w-4 mt-0.5 shrink-0 text-accent" />
                    ) : (
                      <X className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
                    )}
                    <span>
                      <span className={c.ok ? "text-foreground" : "text-destructive"}>{c.label}</span>
                      <span className="block text-xs text-muted-foreground">{c.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                These checks validate the values you pasted and how they fit together. The final live handshake still
                depends on the SHA-1 and package name being registered on the Android client in Google Cloud.
              </p>
            </div>
          ) : null}
        </div>

        <div className="mt-6 rounded-xl border border-border bg-card px-5 py-4 text-sm">
          <p className="text-foreground font-medium flex items-center gap-2">
            <Terminal className="h-4 w-4 text-accent" /> How to retrieve your SHA-1 fingerprints
          </p>

          <p className="mt-3 text-xs uppercase tracking-wide text-muted-foreground">Debug keystore (local testing)</p>
          <p className="mt-1 text-muted-foreground text-xs">
            Android Studio creates this automatically the first time you build. Password is always <code>android</code>.
          </p>
          <div className="mt-2 space-y-2">
            <p className="text-xs text-muted-foreground">macOS / Linux</p>
            <CopyRow value="keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android" />
            <p className="text-xs text-muted-foreground">Windows (PowerShell)</p>
            <CopyRow value="keytool -list -v -keystore $env:USERPROFILE\\.android\\debug.keystore -alias androiddebugkey -storepass android -keypass android" />
            <p className="text-xs text-muted-foreground">Or from the project (Gradle)</p>
            <CopyRow value="cd android && ./gradlew signingReport" />
          </div>

          <p className="mt-4 text-xs uppercase tracking-wide text-muted-foreground">Release keystore (Play Store)</p>
          <p className="mt-1 text-muted-foreground text-xs">
            Use your own upload keystore. Create one once, then keep it backed up — losing it means you cannot ship
            updates.
          </p>
          <div className="mt-2 space-y-2">
            <p className="text-xs text-muted-foreground">Create a release keystore</p>
            <CopyRow value="keytool -genkeypair -v -keystore release.keystore -alias upload -keyalg RSA -keysize 2048 -validity 10000" />
            <p className="text-xs text-muted-foreground">Read its fingerprint</p>
            <CopyRow value="keytool -list -v -keystore release.keystore -alias upload" />
          </div>

          <p className="mt-4 text-xs uppercase tracking-wide text-muted-foreground">Play App Signing</p>
          <p className="mt-1 text-muted-foreground text-xs">
            Google re-signs your app before distribution. Copy the SHA-1 shown under{" "}
            <b>Play Console → your app → Test and release → Setup → App signing</b> and paste it into the Play App
            Signing SHA-1 field above. Register that same fingerprint on your Android OAuth client in Google Cloud.
          </p>

          <p className="mt-4 text-muted-foreground text-xs">
            In the command output, look for the line starting with <code>SHA1:</code> and copy the colon-separated hex
            value into the matching field above — pasting it without colons works too, it gets formatted on blur.
          </p>
        </div>

        <TroubleshootingPanel form={form} />



        <div className="mt-6 rounded-xl border border-dashed border-border bg-card/40 px-5 py-4 text-sm">
          <p className="text-foreground font-medium flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-accent" /> Where these go in Google Cloud
          </p>
          <ol className="mt-2 space-y-1.5 list-decimal pl-5 text-muted-foreground">
            <li>Open <b>APIs &amp; Services → Credentials → Create credentials → OAuth client ID</b>.</li>
            <li>Application type <b>Android</b>; paste the package name and the <b>debug</b> SHA-1. Save.</li>
            <li>Add the <b>release</b> SHA-1 as a second fingerprint (a second Android client, or edit the same one).</li>
            <li>If you use Play App Signing, also add the <b>Play App Signing</b> SHA-1 to the Android client.</li>
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

const Field = React.forwardRef<
  HTMLInputElement,
  {
    label: string;
    hint?: string;
    value: string;
    onChange: (v: string) => void;
    onBlurFormat?: (v: string) => void;
    error?: string;
    placeholder?: string;
    mono?: boolean;
    active?: boolean;
  }
>(function Field({ label, hint, value, onChange, onBlurFormat, error, placeholder, mono, active }, ref) {
  const fieldId = `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={fieldId} className="flex items-center gap-2">
        {label}
        {active ? (
          <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
            paste here
          </span>
        ) : null}
      </Label>
      <Input
        id={fieldId}
        ref={ref}
        value={value}
        maxLength={255}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onBlurFormat?.(e.target.value)}
        className={`${mono ? "font-mono text-xs" : ""} ${error ? "border-destructive" : ""} ${active ? "border-accent ring-1 ring-accent/40" : ""}`}
      />
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
});

function TroubleshootingPanel({ form }: { form: Form }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const pkg = form.package_name || EMPTY.package_name;
  const androidId = form.android_client_id;
  const reversedId = androidId ? androidId.split(".").reverse().join(".") : "";

  const rows: { label: string; value: string; where: string }[] = [
    { label: "Package name", value: pkg, where: "Google Cloud → Credentials → Android OAuth client → Package name" },
    { label: "Debug SHA-1", value: form.debug_sha1, where: "Android client → SHA-1 certificate fingerprint" },
    { label: "Release SHA-1", value: form.release_sha1, where: "Android client → second fingerprint (or a second client)" },
    { label: "Play App Signing SHA-1", value: form.play_sha1, where: "Android client → fingerprint from Play Console app signing" },
    { label: "Android client ID", value: androidId, where: "Used by the native Google Sign-In flow" },
    { label: "Web client ID", value: form.web_client_id, where: "Used for server-side token exchange and Gmail import" },
    { label: "Authorized JavaScript origin", value: origin, where: "Web OAuth client → Authorized JavaScript origins" },
    { label: "Authorized redirect URI", value: origin ? `${origin}/auth` : "", where: "Web OAuth client → Authorized redirect URIs" },
    { label: "OAuth callback URI", value: origin ? `${origin}/~oauth/callback` : "", where: "Web OAuth client → Authorized redirect URIs" },
    { label: "Android reversed-client scheme", value: reversedId, where: "Custom URL scheme, if your native flow needs one" },
  ];

  return (
    <div className="mt-6 rounded-xl border border-border bg-card px-5 py-4 text-sm">
      <p className="text-foreground font-medium flex items-center gap-2">
        <Wrench className="h-4 w-4 text-accent" /> Troubleshooting · exact values to register
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Every value Google Cloud asks for, exactly as this app uses it. Copy each one straight into the matching field —
        mismatched characters, trailing slashes or a wrong fingerprint are the usual cause of{" "}
        <code>redirect_uri_mismatch</code> and <code>DEVELOPER_ERROR</code>.
      </p>

      <div className="mt-4 space-y-3">
        {rows.map((row) => (
          <div key={row.label}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-xs font-medium text-foreground">{row.label}</p>
              {!row.value ? (
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">not set yet</span>
              ) : null}
            </div>
            {row.value ? (
              <div className="mt-1">
                <CopyRow value={row.value} />
              </div>
            ) : (
              <div className="mt-1 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                Fill this in above to get a copyable value.
              </div>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">{row.where}</p>
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs uppercase tracking-wide text-muted-foreground">Common errors</p>
      <ul className="mt-1.5 space-y-1.5 text-xs text-muted-foreground list-disc pl-5">
        <li>
          <code>redirect_uri_mismatch</code> — the origin or redirect URI above is missing from the Web client, or was
          saved with a trailing slash.
        </li>
        <li>
          <code>DEVELOPER_ERROR</code> / code 10 on device — the SHA-1 of the build you installed is not on the Android
          client. Debug builds need the debug fingerprint; Play installs need the Play App Signing fingerprint.
        </li>
        <li>
          <code>access_denied</code> — your Google account is not listed under OAuth consent screen → Test users while
          the app is in Testing.
        </li>
        <li>
          <code>invalid_client</code> — the client ID belongs to a different Google Cloud project than the one the
          consent screen is configured in.
        </li>
      </ul>
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
