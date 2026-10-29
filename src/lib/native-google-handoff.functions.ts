import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const challengeSchema = z.object({
  codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

const redeemSchema = z.object({
  handoffCode: z.string().min(80).max(1800),
  codeVerifier: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

export const createNativeGoogleHandoff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(challengeSchema)
  .handler(async ({ data, context }): Promise<{ handoffCode: string }> => {
    const { data: userData, error } = await context.supabase.auth.getUser();
    const user = userData.user;
    if (
      error ||
      !user ||
      user.id !== context.userId ||
      !user.email ||
      !user.email_confirmed_at
    ) {
      throw new Error("A verified browser sign-in is required to continue.");
    }

    const { issueNativeGoogleHandoff } = await import("./native-google-handoff.server");
    return {
      handoffCode: await issueNativeGoogleHandoff({
        userId: user.id,
        email: user.email,
        codeChallenge: data.codeChallenge,
        state: data.state,
      }),
    };
  });

export const redeemNativeGoogleHandoff = createServerFn({ method: "POST" })
  .inputValidator(redeemSchema)
  .handler(async ({ data }): Promise<{ access_token: string; refresh_token: string }> => {
    const { redeemNativeGoogleHandoffCode } = await import("./native-google-handoff.server");
    return redeemNativeGoogleHandoffCode(data);
  });
