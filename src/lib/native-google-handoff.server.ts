import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const HANDOFF_TTL_MS = 90_000;
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type NativeHandoffPayload = {
  version: 1;
  userId: string;
  tokenHash: string;
  codeChallenge: string;
  expiresAt: number;
};

function encryptionKey(secret: string): Buffer {
  return createHash("sha256").update(`chronos-v:native-google-handoff:v1:${secret}`).digest();
}

function constantTimeStringEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The URL-safe handoff envelope contains no readable credentials. AES-GCM
 * protects the one-time Supabase email token hash; the app's PKCE verifier
 * is required before the server will redeem it.
 */
export function encryptNativeHandoff(
  payload: NativeHandoffPayload,
  secret: string,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

export function decryptNativeHandoff(
  handoffCode: string,
  secret: string,
  now = Date.now(),
): NativeHandoffPayload {
  try {
    if (
      typeof handoffCode !== "string" ||
      handoffCode.length > 1800 ||
      !/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{1,1500}\.[A-Za-z0-9_-]{22}$/.test(handoffCode)
    ) {
      throw new Error("invalid");
    }

    const [, ivPart, ciphertextPart, tagPart] = handoffCode.split(".");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(secret),
      Buffer.from(ivPart, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const payload = JSON.parse(plaintext) as Partial<NativeHandoffPayload>;

    if (
      payload.version !== 1 ||
      typeof payload.userId !== "string" ||
      !payload.userId ||
      typeof payload.tokenHash !== "string" ||
      !payload.tokenHash ||
      payload.tokenHash.length > 512 ||
      typeof payload.codeChallenge !== "string" ||
      !CHALLENGE_PATTERN.test(payload.codeChallenge) ||
      typeof payload.expiresAt !== "number" ||
      !Number.isFinite(payload.expiresAt) ||
      payload.expiresAt <= now
    ) {
      throw new Error("invalid");
    }

    return payload as NativeHandoffPayload;
  } catch {
    throw new Error("The Google sign-in handoff is invalid or has expired.");
  }
}

function requiredHandoffSecret(): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Native sign-in handoff is not configured.");
  return secret;
}

export async function issueNativeGoogleHandoff(input: {
  userId: string;
  email: string;
  codeChallenge: string;
}): Promise<string> {
  if (!CHALLENGE_PATTERN.test(input.codeChallenge)) {
    throw new Error("Native sign-in handoff could not be created.");
  }

  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email: input.email,
  });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    throw new Error("Native sign-in handoff could not be created.");
  }

  const payload: NativeHandoffPayload = {
    version: 1,
    userId: input.userId,
    tokenHash,
    codeChallenge: input.codeChallenge,
    expiresAt: Date.now() + HANDOFF_TTL_MS,
  };
  return encryptNativeHandoff(payload, requiredHandoffSecret());
}

export async function redeemNativeGoogleHandoffCode(input: {
  handoffCode: string;
  codeVerifier: string;
}): Promise<{ access_token: string; refresh_token: string }> {
  const secret = requiredHandoffSecret();
  const payload = decryptNativeHandoff(input.handoffCode, secret);

  if (
    typeof input.codeVerifier !== "string" ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(input.codeVerifier)
  ) {
    throw new Error("The Google sign-in handoff is invalid or has expired.");
  }

  const actualChallenge = createHash("sha256")
    .update(input.codeVerifier, "utf8")
    .digest("base64url");
  if (!constantTimeStringEqual(actualChallenge, payload.codeChallenge)) {
    throw new Error("The Google sign-in handoff is invalid or has expired.");
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) {
    throw new Error("Native sign-in handoff is not configured.");
  }

  // Redeem the one-time token hash on the server. Only the resulting session
  // is returned over HTTPS JSON; neither session tokens nor the token hash
  // are ever placed in a deep-link URL.
  const authClient = createClient<Database>(supabaseUrl, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await authClient.auth.verifyOtp({
    token_hash: payload.tokenHash,
    type: "magiclink",
  });

  if (
    error ||
    !data.session ||
    !data.user ||
    data.user.id !== payload.userId
  ) {
    throw new Error("Google sign-in could not be completed. Please restart sign-in.");
  }

  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  };
}
