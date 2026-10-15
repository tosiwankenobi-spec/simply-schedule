import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PrivacyStatus } from "./privacy.server";

export type { PrivacyProvider, PrivacyStatus } from "./privacy.server";

const providerSchema = z.enum(["google_calendar", "gmail", "outlook_mail"]);

export const getPrivacyStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PrivacyStatus> => {
    const { readPrivacyStatus } = await import("./privacy.server");
    return readPrivacyStatus(context.supabase as never, context.userId);
  });

export const setProviderAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      provider: providerSchema,
      enabled: z.boolean(),
    }),
  )
  .handler(async ({ data, context }): Promise<PrivacyStatus> => {
    const { setPrivacyProviderAccess } = await import("./privacy.server");
    return setPrivacyProviderAccess(
      context.supabase as never,
      context.userId,
      data.provider,
      data.enabled,
    );
  });

export const deleteProviderData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ provider: providerSchema }))
  .handler(async ({ data, context }): Promise<{ removed: number }> => {
    const { deletePrivacyProviderData } = await import("./privacy.server");
    return deletePrivacyProviderData(context.supabase as never, context.userId, data.provider);
  });

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ confirm: z.literal("DELETE") }))
  .handler(async ({ context }): Promise<{ deleted: boolean }> => {
    const userId = context.userId;
    const { error } = await (context.supabase as never as {
      rpc: (fn: string) => Promise<{ error: { message: string } | null }>;
    }).rpc("delete_my_account");
    if (error) {
      throw new Error(error.message || "Couldn't delete your data");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (authError) {
      throw new Error("Your data was deleted, but the sign-in record could not be removed.");
    }
    return { deleted: true };
  });
