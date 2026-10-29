import { describe, expect, test } from "vitest";
import { decryptNativeHandoff, encryptNativeHandoff } from "../src/lib/native-google-handoff.server";

const secret = "synthetic-server-secret-for-tests-only";
const payload = {
  version: 1 as const,
  userId: "11111111-2222-4333-8444-555555555555",
  tokenHash: "synthetic-one-time-token-hash",
  codeChallenge: "A".repeat(43),
  state: "B".repeat(43),
  expiresAt: 2_000_000_000_000,
};

describe("native Google handoff envelope", () => {
  test("encrypts and decrypts a short-lived PKCE-bound payload", () => {
    const code = encryptNativeHandoff(payload, secret);
    expect(code).not.toContain(payload.tokenHash);
    expect(decryptNativeHandoff(code, secret, 1_900_000_000_000)).toEqual(payload);
  });

  test("rejects tampering and a wrong server key", () => {
    const code = encryptNativeHandoff(payload, secret);
    expect(() => decryptNativeHandoff(code.slice(0, -1) + (code.endsWith("A") ? "B" : "A"), secret, 1_900_000_000_000)).toThrow();
    expect(() => decryptNativeHandoff(code, "a-different-secret", 1_900_000_000_000)).toThrow();
  });

  test("rejects expired handoffs", () => {
    const code = encryptNativeHandoff(payload, secret);
    expect(() => decryptNativeHandoff(code, secret, payload.expiresAt)).toThrow(/expired/);
  });
});
