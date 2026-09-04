import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { CalendarDays, Eye, EyeOff, ShieldCheck, Sparkles } from "lucide-react";

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    next:
      typeof s.next === "string" && s.next.startsWith("/") && !s.next.startsWith("//")
        ? s.next
        : undefined,
  }),
  component: AuthPage,
  head: () => ({
    meta: [
      { title: "Sign in · Chronos-V" },
      {
        name: "description",
        content: "Sign in or create your private Chronos-V planning account.",
      },
    ],
  }),
});

const AUTH_FEATURES = [
  {
    icon: CalendarDays,
    title: "One calm timeline",
    description: "Appointments, tasks, routines, and shared commitments in one place.",
  },
  {
    icon: Sparkles,
    title: "A realistic daily plan",
    description: "Flexible work is fitted around the commitments that cannot move.",
  },
  {
    icon: ShieldCheck,
    title: "Private by design",
    description: "You choose every connection and keep control of imported data.",
  },
] as const;

function AuthPage() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const goNext = () => {
    if (next) window.location.href = next;
    else navigate({ to: "/app" });
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      if (next) window.location.href = next;
      else navigate({ to: "/app" });
    });
  }, [navigate, next]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setAuthError(null);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: next ? window.location.origin + next : window.location.origin,
          },
        });
        if (error) throw error;
        toast.success("Welcome — check your inbox if confirmation is required.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      goNext();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Authentication failed";
      setAuthError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    setAuthError(null);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: next ? window.location.origin + next : window.location.origin,
    });
    if (result.error) {
      setAuthError("Google sign-in failed. Please try again.");
      toast.error("Google sign-in failed");
      setLoading(false);
      return;
    }
    if (result.redirected) return;
    goNext();
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-ink lg:grid lg:grid-cols-[minmax(0,1.08fr)_minmax(430px,0.92fr)]">
      <section className="relative hidden min-h-screen flex-col justify-between overflow-hidden px-14 py-12 text-paper lg:flex">
        <div className="pointer-events-none absolute -left-32 top-1/4 h-80 w-80 rounded-full bg-accent/15 blur-3xl" />
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-leaf/15 blur-3xl" />

        <div className="relative flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-paper/10 ring-1 ring-paper/15">
            <img src="/favicon.png" alt="" className="h-7 w-7" />
          </span>
          <div>
            <p className="font-serif text-xl leading-none">Chronos-V</p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-paper/45">
              Life, intelligently timed
            </p>
          </div>
        </div>

        <div className="relative my-12 max-w-2xl lg:my-16">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
            Your intelligent schedule
          </p>
          <h1 className="mt-4 max-w-xl font-serif text-4xl leading-[1.05] sm:text-5xl lg:text-6xl">
            Make space for the life you actually want to live.
          </h1>
          <p className="mt-5 max-w-xl text-sm leading-relaxed text-paper/60 sm:text-base">
            Chronos-V brings every commitment together, builds a plan that fits reality, and helps
            the day recover when life changes.
          </p>

          <div className="mt-8 hidden gap-3 sm:grid lg:grid-cols-3">
            {AUTH_FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className="rounded-2xl border border-paper/10 bg-paper/5 p-4"
                >
                  <Icon className="h-5 w-5 text-gold" />
                  <p className="mt-3 text-sm font-medium">{feature.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-paper/50">
                    {feature.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <p className="relative text-xs leading-relaxed text-paper/40">
          Your connected sources remain under your control. Pause access or delete imported copies
          whenever you choose.
        </p>
      </section>

      <section className="verolane-wash relative flex min-h-screen items-center bg-background px-4 py-8 sm:px-8 lg:px-12">
        <div className="pointer-events-none absolute inset-0 paper-grain opacity-20" />
        <div className="relative mx-auto w-full max-w-md rounded-3xl border border-border/80 bg-card/95 p-6 shadow-[0_30px_80px_rgba(0,46,40,0.13)] sm:p-8">
          <div className="mb-6 flex items-center justify-center gap-2.5 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink">
              <img src="/favicon.png" alt="" className="h-6 w-6" />
            </span>
            <div>
              <p className="font-serif text-lg leading-none">Chronos-V</p>
              <p className="mt-1 text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                Life, intelligently timed
              </p>
            </div>
          </div>

          <div
            className="grid grid-cols-2 rounded-xl bg-secondary/60 p-1"
            aria-label="Account action"
          >
            <button
              type="button"
              aria-pressed={mode === "signin"}
              onClick={() => {
                setMode("signin");
                setAuthError(null);
              }}
              disabled={loading}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                mode === "signin"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              aria-pressed={mode === "signup"}
              onClick={() => {
                setMode("signup");
                setAuthError(null);
              }}
              disabled={loading}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                mode === "signup"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Create account
            </button>
          </div>

          <div className="mt-7">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
              {mode === "signin" ? "Welcome back" : "Begin with Chronos-V"}
            </p>
            <h2 className="mt-2 font-serif text-3xl leading-tight text-foreground">
              {mode === "signin" ? "Your day is waiting." : "Make room for what matters."}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {mode === "signin"
                ? next
                  ? "Sign in to continue securely."
                  : "Sign in to return to your unified schedule."
                : "Create your private account and start building a schedule around real life."}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-7 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 bg-background"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 bg-background pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {mode === "signup" ? (
                <p className="text-xs text-muted-foreground">Use at least six characters.</p>
              ) : null}
            </div>

            {authError ? (
              <p
                role="alert"
                className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {authError}
              </p>
            ) : null}

            <Button type="submit" disabled={loading} className="h-11 w-full">
              <span aria-live="polite">
                {loading ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
              </span>
            </Button>
          </form>

          <div className="relative my-6 text-center text-xs text-muted-foreground">
            <span className="relative z-10 bg-card px-3">or continue with</span>
            <span className="absolute left-0 right-0 top-1/2 h-px bg-border" />
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={handleGoogle}
            disabled={loading}
            className="h-11 w-full bg-background"
          >
            <span className="mr-2 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-[10px] font-semibold text-background">
              G
            </span>
            Continue with Google
          </Button>

          <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
            By continuing, you create a private session on this device. Connected calendars and
            inboxes are always optional.
          </p>
        </div>
      </section>
    </main>
  );
}
