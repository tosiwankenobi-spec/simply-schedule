import { describe, expect, it } from "vitest";

import {
  buildEmailVerificationRedirect,
  readAuthRedirectError,
} from "../src/lib/auth-verification";

describe("email verification helpers", () => {
  it("builds a verification callback and preserves a safe destination", () => {
    expect(buildEmailVerificationRedirect("https://chronos.example", "/today?focus=1")).toBe(
      "https://chronos.example/auth?verified=1&next=%2Ftoday%3Ffocus%3D1",
    );
  });

  it("rejects protocol-relative destinations", () => {
    expect(buildEmailVerificationRedirect("https://chronos.example", "//attacker.example")).toBe(
      "https://chronos.example/auth?verified=1",
    );
  });

  it("reads verification errors from query strings or URL fragments", () => {
    expect(readAuthRedirectError("?error_description=Link+expired", "")).toBe("Link expired");
    expect(readAuthRedirectError("", "#error=access_denied")).toBe("access_denied");
  });
});
