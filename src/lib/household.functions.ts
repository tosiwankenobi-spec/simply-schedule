import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const nameSchema = z.string().trim().min(1).max(80);
const householdIdSchema = z.object({ householdId: z.string().uuid() });
const inviteIdSchema = z.object({ inviteId: z.string().uuid() });

export type HouseholdMember = {
  user_id: string;
  household_id: string;
  display_name: string;
  role: "owner" | "member";
  created_at: string;
};

export type ShareableAppointment = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  household_id: string | null;
  household_visibility: "private" | "busy" | "details";
};

export type HouseholdOverview = {
  household: {
    id: string;
    name: string;
    owner_user_id: string;
    created_at: string;
    updated_at: string;
  };
  membership: HouseholdMember;
  members: HouseholdMember[];
  invites: {
    id: string;
    expires_at: string;
    created_at: string;
  }[];
  appointments: ShareableAppointment[];
};

export const getHouseholdOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<HouseholdOverview | null> => {
    const { data: membership, error: membershipError } = await context.supabase
      .from("household_members")
      .select("user_id,household_id,display_name,role,created_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) return null;

    const householdId = membership.household_id;
    const appointmentFloor = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [householdResult, membersResult, invitesResult, appointmentsResult] = await Promise.all([
      context.supabase.from("households").select("*").eq("id", householdId).single(),
      context.supabase
        .from("household_members")
        .select("user_id,household_id,display_name,role,created_at")
        .eq("household_id", householdId)
        .order("role", { ascending: false })
        .order("display_name"),
      membership.role === "owner"
        ? context.supabase
            .from("household_invites")
            .select("id,expires_at,created_at")
            .eq("household_id", householdId)
            .gt("expires_at", new Date().toISOString())
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      context.supabase
        .from("appointments")
        .select("id,title,starts_at,ends_at,location,household_id,household_visibility")
        .eq("user_id", context.userId)
        .gte("starts_at", appointmentFloor)
        .order("starts_at")
        .limit(100),
    ]);

    if (householdResult.error) throw householdResult.error;
    if (membersResult.error) throw membersResult.error;
    if (invitesResult.error) throw invitesResult.error;
    if (appointmentsResult.error) throw appointmentsResult.error;

    return {
      household: householdResult.data,
      membership: membership as HouseholdMember,
      members: (membersResult.data ?? []) as HouseholdMember[],
      invites: invitesResult.data ?? [],
      appointments: (appointmentsResult.data ?? []) as ShareableAppointment[],
    };
  });

export const createHousehold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ name: nameSchema, displayName: nameSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: householdId, error } = await context.supabase.rpc("create_household", {
      p_name: data.name,
      p_display_name: data.displayName,
    });
    if (error) throw error;
    return { householdId };
  });

export const joinHousehold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ inviteId: z.string().uuid(), displayName: nameSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: householdId, error } = await context.supabase.rpc("join_household", {
      p_invite_id: data.inviteId,
      p_display_name: data.displayName,
    });
    if (error) throw error;
    return { householdId };
  });

export const createHouseholdInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => householdIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: inviteId, error } = await context.supabase.rpc("create_household_invite", {
      p_household_id: data.householdId,
    });
    if (error) throw error;
    return { inviteId };
  });

export const revokeHouseholdInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inviteIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: invite, error } = await context.supabase
      .from("household_invites")
      .delete()
      .eq("id", data.inviteId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!invite) throw new Error("That invitation is no longer available.");
    return { revoked: true };
  });

export const leaveHousehold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => householdIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: membership, error } = await context.supabase
      .from("household_members")
      .delete()
      .eq("household_id", data.householdId)
      .eq("user_id", context.userId)
      .eq("role", "member")
      .select("user_id")
      .maybeSingle();
    if (error) throw error;
    if (!membership) throw new Error("Only members can leave a household.");
    return { left: true };
  });

export const removeHouseholdMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    householdIdSchema.extend({ userId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: membership, error } = await context.supabase
      .from("household_members")
      .delete()
      .eq("household_id", data.householdId)
      .eq("user_id", data.userId)
      .eq("role", "member")
      .select("user_id")
      .maybeSingle();
    if (error) throw error;
    if (!membership) throw new Error("That member is no longer available.");
    return { removed: true };
  });

export const deleteHousehold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => householdIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: household, error } = await context.supabase
      .from("households")
      .delete()
      .eq("id", data.householdId)
      .eq("owner_user_id", context.userId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!household) throw new Error("Only the owner can delete this household.");
    return { deleted: true };
  });

export const setAppointmentHouseholdVisibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        appointmentId: z.string().uuid(),
        householdId: z.string().uuid(),
        visibility: z.enum(["private", "busy", "details"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const sharing =
      data.visibility === "private"
        ? { household_id: null, household_visibility: "private" }
        : { household_id: data.householdId, household_visibility: data.visibility };
    const { data: appointment, error } = await context.supabase
      .from("appointments")
      .update(sharing)
      .eq("id", data.appointmentId)
      .eq("user_id", context.userId)
      .select("id,household_visibility")
      .maybeSingle();
    if (error) throw error;
    if (!appointment) throw new Error("That appointment is no longer available.");
    return appointment;
  });
