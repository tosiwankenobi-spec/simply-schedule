import { createFileRoute, Link } from "@tanstack/react-router";
import type { ComponentType } from "react";
import {
  ArrowRight,
  BellRing,
  CalendarArrowUp,
  CalendarClock,
  CalendarRange,
  Clock3,
  Mail,
  Settings2,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
  head: () => ({
    meta: [
      { title: "Settings · Chronos-V" },
      {
        name: "description",
        content:
          "Manage planning preferences, connected sources, reminders, devices, and privacy controls.",
      },
    ],
  }),
});

type SettingsPath =
  | "/planner/preferences"
  | "/welcome"
  | "/setup/sync"
  | "/setup/gmail"
  | "/setup/outlook"
  | "/setup/notifications"
  | "/privacy"
  | "/setup/android"
  | "/calendar-import";

type SettingsCard = {
  title: string;
  description: string;
  action: string;
  to: SettingsPath;
  icon: ComponentType<{ className?: string }>;
};

const SETTINGS_GROUPS: Array<{
  id: string;
  title: string;
  description: string;
  cards: SettingsCard[];
}> = [
  {
    id: "planning",
    title: "Planning",
    description: "Shape how Chronos-V builds a day around your energy and availability.",
    cards: [
      {
        title: "Working rhythm",
        description: "Working hours, meeting length, breaks, lunch, and special constraints.",
        action: "Planner preferences",
        to: "/planner/preferences",
        icon: Clock3,
      },
      {
        title: "Getting started",
        description: "Return to the guided setup, review progress, or finish the next step.",
        action: "Open setup guide",
        to: "/welcome",
        icon: Sparkles,
      },
    ],
  },
  {
    id: "connections",
    title: "Connections & reminders",
    description: "Choose what enters your timeline and how Chronos-V helps you prepare.",
    cards: [
      {
        title: "Calendar connections",
        description: "Select calendars, control conflict behavior, and review sync health.",
        action: "Manage calendars",
        to: "/setup/sync",
        icon: CalendarRange,
      },
      {
        title: "Smart Inbox",
        description: "Set up private Gmail detection for appointments, deliveries, and deadlines.",
        action: "Review Gmail setup",
        to: "/setup/gmail",
        icon: Mail,
      },
      {
        title: "Microsoft Outlook",
        description: "Prepare private per-user calendar and Smart Inbox access through Microsoft.",
        action: "Review Outlook setup",
        to: "/setup/outlook",
        icon: CalendarClock,
      },
      {
        title: "Adaptive reminders",
        description: "Lead times, quiet hours, preparation prompts, and travel alerts.",
        action: "Reminder preferences",
        to: "/setup/notifications",
        icon: BellRing,
      },
    ],
  },
  {
    id: "privacy-devices",
    title: "Privacy & devices",
    description: "Keep data access visible and bring Chronos-V to the devices you use.",
    cards: [
      {
        title: "Privacy controls",
        description: "See what each source can read, pause access, or delete imported copies.",
        action: "Open privacy controls",
        to: "/privacy",
        icon: ShieldCheck,
      },
      {
        title: "Android app",
        description: "Prepare the native app, deep links, OAuth callbacks, and secure builds.",
        action: "Android setup",
        to: "/setup/android",
        icon: Smartphone,
      },
      {
        title: "Calendar file import",
        description: "Bring in an ICS file without connecting an online calendar account.",
        action: "Import a calendar",
        to: "/calendar-import",
        icon: CalendarArrowUp,
      },
    ],
  },
];

function SettingsPage() {
  return (
    <div className="verolane-wash relative min-h-screen bg-background">
      <div className="pointer-events-none absolute inset-0 paper-grain opacity-20" />
      <div className="relative mx-auto max-w-[1180px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <WorkspaceHeader
          eyebrow="Control center"
          title={
            <>
              Settings, <span className="text-accent italic">without the maze.</span>
            </>
          }
          description="Everything that shapes your plan, connections, reminders, and privacy—organized in one place. Opening a section never grants new access or changes a setting."
          action={
            <Button asChild variant="outline" className="bg-card/70">
              <Link to="/privacy">
                <ShieldCheck className="mr-1.5 h-4 w-4" /> Privacy overview
              </Link>
            </Button>
          }
        />

        <section className="relative mt-6 overflow-hidden rounded-3xl bg-ink p-5 text-paper shadow-[0_22px_55px_rgba(0,46,40,0.14)] sm:p-7">
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full border border-paper/10" />
          <div className="relative grid gap-5 md:grid-cols-[auto_1fr_auto] md:items-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-paper/10 text-leaf ring-1 ring-paper/15">
              <Settings2 className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-leaf">
                You stay in control
              </p>
              <h2 className="mt-1 font-serif text-2xl">Review freely. Change deliberately.</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-paper/60">
                Chronos-V keeps connected sources optional and explains their purpose before you
                enable them.
              </p>
            </div>
            <Button asChild variant="ghost" className="bg-paper text-ink hover:bg-paper/90">
              <Link to="/welcome">
                Review setup <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </section>

        <div className="mt-9 space-y-10 pb-12">
          {SETTINGS_GROUPS.map((group) => (
            <section key={group.id} aria-labelledby={`settings-${group.id}`}>
              <div className="mb-4">
                <h2 id={`settings-${group.id}`} className="font-serif text-2xl text-foreground">
                  {group.title}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">{group.description}</p>
              </div>
              <div
                className={`grid gap-3 md:grid-cols-2 ${
                  group.cards.length > 3
                    ? "xl:grid-cols-4"
                    : group.cards.length > 2
                      ? "xl:grid-cols-3"
                      : ""
                }`}
              >
                {group.cards.map((card) => (
                  <SettingsLink key={card.to} card={card} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function SettingsLink({ card }: { card: SettingsCard }) {
  const Icon = card.icon;
  return (
    <Link
      to={card.to}
      className="group flex min-h-52 flex-col rounded-2xl border border-border/80 bg-card/90 p-5 shadow-[0_12px_35px_rgba(0,46,40,0.035)] outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
    >
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-ink transition-colors group-hover:bg-ink group-hover:text-paper">
        <Icon className="h-4.5 w-4.5" />
      </span>
      <h3 className="mt-5 font-serif text-xl text-foreground">{card.title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{card.description}</p>
      <span className="mt-auto inline-flex items-center gap-2 pt-5 text-sm font-semibold text-accent transition-[gap] group-hover:gap-3">
        {card.action} <ArrowRight className="h-4 w-4" />
      </span>
    </Link>
  );
}
