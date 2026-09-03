import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { ArrowLeft, Copy, Home, Link2, LogOut, ShieldCheck, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import {
  createHousehold,
  createHouseholdInvite,
  deleteHousehold,
  getHouseholdOverview,
  joinHousehold,
  leaveHousehold,
  removeHouseholdMember,
  revokeHouseholdInvite,
  setAppointmentHouseholdVisibility,
  type ShareableAppointment,
} from "@/lib/household.functions";
import { useScheduleEvents } from "@/lib/schedule-hub";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/household")({
  validateSearch: z.object({ invite: z.string().optional() }),
  component: HouseholdPage,
  head: () => ({ meta: [{ title: "Household · Chronos-V" }] }),
});

type Visibility = "private" | "busy" | "details";

function invitationId(value: string) {
  const trimmed = value.trim();
  try {
    return new URL(trimmed).searchParams.get("invite") ?? trimmed;
  } catch {
    return trimmed;
  }
}

function HouseholdPage() {
  const queryClient = useQueryClient();
  const { invite = "" } = Route.useSearch();
  const [householdName, setHouseholdName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState(invite);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const overview = useQuery({ queryKey: ["household"], queryFn: () => getHouseholdOverview() });
  const schedule = useScheduleEvents();

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["household"] });
    queryClient.invalidateQueries({ queryKey: ["appointments"] });
  };
  const mutationError = (error: unknown) =>
    toast.error(error instanceof Error ? error.message : "That household action failed.");
  const copyInvite = async (inviteId: string) => {
    const url = `${window.location.origin}/household?invite=${inviteId}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Private invitation link copied", {
        description: "It expires in seven days. Share it only with people you trust.",
      });
    } catch {
      toast.error("Couldn’t copy automatically", { description: inviteId });
    }
  };
  const create = useMutation({
    mutationFn: () => createHousehold({ data: { name: householdName, displayName } }),
    onSuccess: () => {
      refresh();
      toast.success("Household created");
    },
    onError: mutationError,
  });
  const join = useMutation({
    mutationFn: () => joinHousehold({ data: { inviteId: invitationId(inviteCode), displayName } }),
    onSuccess: () => {
      refresh();
      toast.success("Household joined");
    },
    onError: mutationError,
  });
  const makeInvite = useMutation({
    mutationFn: (householdId: string) => createHouseholdInvite({ data: { householdId } }),
    onSuccess: async ({ inviteId }) => {
      refresh();
      await copyInvite(inviteId);
    },
    onError: mutationError,
  });
  const revoke = useMutation({
    mutationFn: (inviteId: string) => revokeHouseholdInvite({ data: { inviteId } }),
    onSuccess: () => {
      refresh();
      toast.success("Invitation revoked");
    },
    onError: mutationError,
  });
  const leave = useMutation({
    mutationFn: (householdId: string) => leaveHousehold({ data: { householdId } }),
    onSuccess: () => {
      refresh();
      toast.success("You left the household");
    },
    onError: mutationError,
  });
  const remove = useMutation({
    mutationFn: (householdId: string) => deleteHousehold({ data: { householdId } }),
    onSuccess: () => {
      setConfirmDelete(false);
      refresh();
      toast.success("Household deleted; everyone’s items are private again");
    },
    onError: mutationError,
  });
  const disconnect = useMutation({
    mutationFn: (input: { householdId: string; userId: string }) =>
      removeHouseholdMember({ data: input }),
    onSuccess: () => {
      refresh();
      toast.success("Member disconnected; their items are private again");
    },
    onError: mutationError,
  });
  const share = useMutation({
    mutationFn: (input: { appointmentId: string; householdId: string; visibility: Visibility }) =>
      setAppointmentHouseholdVisibility({ data: input }),
    onSuccess: () => {
      refresh();
      toast.success("Sharing updated");
    },
    onError: mutationError,
  });
  const sharedFromOthers = useMemo(() => {
    const recentFloor = Date.now() - 24 * 60 * 60 * 1000;
    return (schedule.data ?? []).filter(
      (event) =>
        event.is_household_shared && Date.parse(event.ends_at ?? event.starts_at) >= recentFloor,
    );
  }, [schedule.data]);

  if (overview.isLoading) {
    return (
      <PageShell>
        <div className="h-40 animate-pulse rounded-xl bg-card" />
      </PageShell>
    );
  }
  if (!overview.data) {
    return (
      <PageShell>
        <div className="mt-6">
          <p className="flex items-center gap-2 text-sm font-medium text-accent">
            <Users className="h-4 w-4" /> Coordinate without oversharing
          </p>
          <h1 className="mt-2 font-serif text-4xl">Household schedule</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Create a household or use a private invitation. Every schedule item stays private until
            its owner explicitly shares busy time or full details.
          </p>
        </div>
        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-serif text-xl">Create a household</h2>
            <Field
              label="Household name"
              value={householdName}
              onChange={setHouseholdName}
              placeholder="The Rivera family"
            />
            <Field
              label="Your display name"
              value={displayName}
              onChange={setDisplayName}
              placeholder="Alex"
            />
            <Button
              className="mt-4 w-full"
              disabled={create.isPending}
              onClick={() => create.mutate()}
            >
              <Home className="mr-1.5 h-4 w-4" /> Create household
            </Button>
          </section>
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-serif text-xl">Join with an invitation</h2>
            <Field
              label="Invitation code"
              value={inviteCode}
              onChange={setInviteCode}
              placeholder="xxxxxxxx-xxxx-…"
            />
            <Field
              label="Your display name"
              value={displayName}
              onChange={setDisplayName}
              placeholder="Alex"
            />
            <Button
              className="mt-4 w-full"
              variant="outline"
              disabled={join.isPending}
              onClick={() => join.mutate()}
            >
              <Link2 className="mr-1.5 h-4 w-4" /> Join household
            </Button>
          </section>
        </div>
      </PageShell>
    );
  }

  const data = overview.data;
  const isOwner = data.membership.role === "owner";
  return (
    <PageShell>
      <div className="mt-6 flex items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-accent">
            <Users className="h-4 w-4" /> {data.members.length} member
            {data.members.length === 1 ? "" : "s"}
          </p>
          <h1 className="mt-2 font-serif text-4xl">{data.household.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Busy-only items hide their title, notes, and location. Private items never leave the
            owner’s schedule.
          </p>
        </div>
        {isOwner ? (
          <Button
            variant="outline"
            onClick={() => makeInvite.mutate(data.household.id)}
            disabled={makeInvite.isPending}
          >
            <Copy className="mr-1.5 h-4 w-4" /> Invite
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={() => leave.mutate(data.household.id)}
            disabled={leave.isPending}
          >
            <LogOut className="mr-1.5 h-4 w-4" /> Leave
          </Button>
        )}
      </div>

      <section className="mt-8 rounded-xl border border-border bg-card p-5">
        <h2 className="font-serif text-xl">People</h2>
        <ul className="mt-3 divide-y divide-border">
          {data.members.map((member) => (
            <li key={member.user_id} className="flex items-center justify-between py-3 text-sm">
              <span>
                {member.display_name}
                {member.user_id === data.membership.user_id ? " · You" : ""}
              </span>
              <span className="flex items-center gap-2">
                <span className="text-xs capitalize text-muted-foreground">{member.role}</span>
                {isOwner && member.role === "member" && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Disconnect ${member.display_name}`}
                    disabled={disconnect.isPending}
                    onClick={() =>
                      disconnect.mutate({
                        householdId: data.household.id,
                        userId: member.user_id,
                      })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
        {isOwner && data.invites.length > 0 && (
          <div className="mt-4 border-t border-border pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Active invitations
            </p>
            {data.invites.map((activeInvite) => (
              <div
                key={activeInvite.id}
                className="mt-2 flex items-center justify-between gap-2 text-xs"
              >
                <span>Expires {format(new Date(activeInvite.expires_at), "MMM d, h:mm a")}</span>
                <span className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void copyInvite(activeInvite.id)}
                  >
                    Copy link
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => revoke.mutate(activeInvite.id)}>
                    Revoke
                  </Button>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-serif text-2xl">Your sharing choices</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose visibility separately for each upcoming item.
        </p>
        <div className="mt-4 space-y-3">
          {data.appointments.length === 0 ? (
            <Empty label="No upcoming items to share." />
          ) : (
            data.appointments.map((appointment) => (
              <AppointmentSharingRow
                key={appointment.id}
                appointment={appointment}
                disabled={share.isPending}
                onChange={(visibility) =>
                  share.mutate({
                    appointmentId: appointment.id,
                    householdId: data.household.id,
                    visibility,
                  })
                }
              />
            ))
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-serif text-2xl">Shared by others</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          These appear automatically in your main timeline.
        </p>
        <div className="mt-4 space-y-3">
          {sharedFromOthers.length === 0 ? (
            <Empty label="Nothing has been shared with you yet." />
          ) : (
            sharedFromOthers.slice(0, 30).map((event) => (
              <div key={event.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{event.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {format(new Date(event.starts_at), "EEE, MMM d · h:mm a")} ·{" "}
                      {event.shared_by_name}
                    </p>
                  </div>
                  <span className="rounded-full bg-secondary px-2 py-1 text-[10px] uppercase text-muted-foreground">
                    {event.household_visibility === "busy" ? "Busy only" : "Details"}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {isOwner && (
        <div className="mt-10 border-t border-border pt-6">
          <Button
            variant="ghost"
            className="text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="mr-1.5 h-4 w-4" /> Delete household
          </Button>
        </div>
      )}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {data.household.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Members will be disconnected and every shared appointment will become private again.
              No appointments will be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => remove.mutate(data.household.id)}
            >
              Delete household
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

function AppointmentSharingRow({
  appointment,
  disabled,
  onChange,
}: {
  appointment: ShareableAppointment;
  disabled: boolean;
  onChange: (visibility: Visibility) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate font-medium">{appointment.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {format(new Date(appointment.starts_at), "EEE, MMM d · h:mm a")}
          {appointment.location ? ` · ${appointment.location}` : ""}
        </p>
      </div>
      <select
        aria-label={`Sharing for ${appointment.title}`}
        value={appointment.household_visibility}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as Visibility)}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="private">Private</option>
        <option value="busy">Busy only</option>
        <option value="details">Full details</option>
      </select>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const id = label.toLowerCase().replaceAll(" ", "-");
  return (
    <div className="mt-4 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        maxLength={80}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-7 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen bg-background">
      <div className="absolute inset-0 paper-grain pointer-events-none opacity-30" />
      <div className="relative mx-auto max-w-2xl px-5 py-8 md:py-12">
        <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
          <Link to="/app">
            <ArrowLeft className="mr-1 h-4 w-4" /> Schedule
          </Link>
        </Button>
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Sharing is opt-in per item. Connections can be revoked or left at any time.</p>
        </div>
        {children}
      </div>
    </div>
  );
}
