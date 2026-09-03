import { lazy, Suspense, useState, type ComponentType, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  CheckSquare2,
  ChevronRight,
  Inbox,
  ListTodo,
  LogOut,
  Plus,
  Repeat2,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

type NavigationItem = {
  label: string;
  to:
    | "/today"
    | "/app"
    | "/planner"
    | "/inbox"
    | "/tasks"
    | "/routines"
    | "/household"
    | "/weekly-reset"
    | "/privacy"
    | "/setup/sync";
  icon: ComponentType<{ className?: string }>;
};

const PRIMARY_NAV: NavigationItem[] = [
  { label: "Today", to: "/today", icon: Sun },
  { label: "Timeline", to: "/app", icon: CalendarDays },
  { label: "AI planner", to: "/planner", icon: Sparkles },
  { label: "Smart inbox", to: "/inbox", icon: Inbox },
  { label: "Tasks", to: "/tasks", icon: ListTodo },
  { label: "Routines", to: "/routines", icon: Repeat2 },
  { label: "Household", to: "/household", icon: Users },
  { label: "Weekly reset", to: "/weekly-reset", icon: CheckSquare2 },
];

const MOBILE_NAV = PRIMARY_NAV.slice(0, 2).concat(PRIMARY_NAV.slice(3, 5));
const QuickCapture = lazy(async () => {
  const module = await import("@/components/QuickCapture");
  return { default: module.QuickCapture };
});

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [captureOpen, setCaptureOpen] = useState(false);

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="min-h-screen bg-background lg:flex">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto bg-ink px-4 py-5 text-paper lg:flex">
        <Link to="/today" className="flex items-center gap-3 rounded-xl px-2 py-1.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-paper/10 ring-1 ring-paper/15">
            <img src="/favicon.png" alt="" className="h-7 w-7" />
          </span>
          <span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.24em] text-paper/55">
              Verolane
            </span>
            <span className="block font-serif text-xl leading-none">Chronos‑V</span>
          </span>
        </Link>

        <p className="mt-8 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-paper/40">
          Your day
        </p>
        <nav className="mt-2 space-y-1" aria-label="Primary navigation">
          {PRIMARY_NAV.map((item) => (
            <DesktopNavigationLink key={item.to} item={item} />
          ))}
        </nav>

        <Button
          type="button"
          variant="ghost"
          onClick={() => setCaptureOpen(true)}
          className="mt-6 h-11 justify-between rounded-xl bg-paper text-ink hover:bg-paper/90 hover:text-ink"
        >
          <span className="inline-flex items-center gap-2">
            <Plus className="h-4 w-4" /> Capture anything
          </span>
          <ChevronRight className="h-4 w-4 opacity-50" />
        </Button>

        <div className="mt-auto space-y-1 pt-8">
          <DesktopNavigationLink
            item={{ label: "Connections", to: "/setup/sync", icon: Settings2 }}
          />
          <DesktopNavigationLink item={{ label: "Privacy", to: "/privacy", icon: ShieldCheck }} />
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-paper/60 transition-colors hover:bg-paper/10 hover:text-paper"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
          <p className="flex items-center gap-1.5 px-3 pt-3 text-[10px] text-paper/40">
            <ShieldCheck className="h-3 w-3" /> Private by design
          </p>
        </div>
      </aside>

      <div className="min-w-0 flex-1 pb-24 lg:pb-0">{children}</div>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid h-[4.75rem] grid-cols-5 border-t border-border/80 bg-paper/95 px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_rgba(0,46,40,0.06)] backdrop-blur-xl lg:hidden"
        aria-label="Mobile navigation"
      >
        {MOBILE_NAV.slice(0, 2).map((item) => (
          <MobileNavigationLink key={item.to} item={item} />
        ))}
        <button
          type="button"
          onClick={() => setCaptureOpen(true)}
          className="group flex flex-col items-center justify-end gap-1 pb-2 text-[10px] font-medium text-ink"
          aria-label="Capture anything"
        >
          <span className="grid h-12 w-12 -translate-y-2 place-items-center rounded-2xl bg-ink text-paper shadow-lg shadow-ink/20 transition-transform group-active:scale-95">
            <Plus className="h-5 w-5" />
          </span>
          <span className="-mt-2">Capture</span>
        </button>
        {MOBILE_NAV.slice(2).map((item) => (
          <MobileNavigationLink key={item.to} item={item} />
        ))}
      </nav>

      <Sheet open={captureOpen} onOpenChange={setCaptureOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[92vh] overflow-y-auto rounded-t-3xl px-4 pb-8"
        >
          <SheetHeader className="mx-auto max-w-3xl text-left">
            <SheetTitle className="font-serif text-2xl">Capture anything</SheetTitle>
          </SheetHeader>
          <div className="mx-auto max-w-3xl [&>section]:mt-4 [&>section]:border-0 [&>section]:p-0">
            {captureOpen ? (
              <Suspense
                fallback={<div className="mt-4 h-28 animate-pulse rounded-2xl bg-secondary" />}
              >
                <QuickCapture />
              </Suspense>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DesktopNavigationLink({ item }: { item: NavigationItem }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-paper/62 transition-colors hover:bg-paper/10 hover:text-paper"
      activeProps={{ className: "bg-paper/12 text-paper" }}
    >
      <Icon className="h-4 w-4" />
      <span>{item.label}</span>
    </Link>
  );
}

function MobileNavigationLink({ item }: { item: NavigationItem }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      className="flex flex-col items-center justify-end gap-1 pb-2 text-[10px] font-medium text-muted-foreground"
      activeProps={{ className: "text-ink" }}
    >
      <Icon className="h-[1.15rem] w-[1.15rem]" />
      <span>{item.label}</span>
    </Link>
  );
}
