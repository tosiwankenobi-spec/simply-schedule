import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PrivacyStatus } from "./privacy.server";

export type { PrivacyProvider, PrivacyStatus } from "./privacy.server";

const providerSchema = z.enum(["google_calendar", "gmail"]);

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
