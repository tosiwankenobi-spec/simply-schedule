/**
 * Server-only signing for replan proposals. The signing key never leaves the
 * server and is never included in a proposal, a log line, or an error.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalPreviewPayload, type SignedMove } from "./plan-preview";

function signingSecret(): Buffer {
  const secret = process.env["PLAN_PREVIEW_SIGNING_SECRET"];
  if (!secret) throw new Error("Automatic replanning is not configured yet.");
  return Buffer.from(secret, "utf8");
}

export function signPreview(
  previewId: string,
  date: string,
  generatedAt: string,
  moves: SignedMove[],
  secret: Buffer = signingSecret(),
): string {
  return createHmac("sha256", secret)
    .update(canonicalPreviewPayload(previewId, date, generatedAt, moves))
    .digest("base64url");
}

/** Constant-time check; a tampered or replayed proposal fails here. */
export function verifyPreview(
  previewId: string,
  date: string,
  generatedAt: string,
  moves: SignedMove[],
  signature: string,
  secret: Buffer = signingSecret(),
): boolean {
  const expected = Buffer.from(signPreview(previewId, date, generatedAt, moves, secret), "utf8");
  const given = Buffer.from(signature ?? "", "utf8");
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}
