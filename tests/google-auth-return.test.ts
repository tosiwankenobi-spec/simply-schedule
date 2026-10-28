import { describe, expect, test } from "vitest";
import { GOOGLE_NATIVE_OPEN_URL, googleBrowserStartUrl, googleReturnDestination, googleReturnUrl, safeAuthNext, validGoogleNativeReturn } from "../src/lib/google-auth-return";

describe("Google native return safety (synthetic)", () => {
  test("opens only the public same-origin browser start", () => {
    expect(googleBrowserStartUrl("https://verolane.online")).toBe("https://verolane.online/auth/google-start");
    expect(googleReturnUrl("https://verolane.online", true)).toBe("https://verolane.online/auth/google-return?native=1");
    expect(googleReturnUrl("https://verolane.online", false)).toBe("https://verolane.online/auth/google-return");
  });
  test("accepts only the exact credential-free native return", () => {
    expect(validGoogleNativeReturn(GOOGLE_NATIVE_OPEN_URL)).toBe(true);
    for (const value of ["https://evil.example/oauth/google/return", GOOGLE_NATIVE_OPEN_URL + "?access_token=synthetic", GOOGLE_NATIVE_OPEN_URL + "#refresh_token=synthetic", "ca.verolane.chronosv://evil/google/return", "ca.verolane.chronosv://oauth/google/return/extra", "not a url"]) {
      expect(validGoogleNativeReturn(value)).toBe(false);
    }
  });
  test("blocks cross-origin next paths including backslash redirects", () => {
    for (const value of ["//evil.example", "/\\evil.example", "https://evil.example", "/auth", "/\n/evil.example"]) expect(safeAuthNext(value)).toBeUndefined();
    expect(safeAuthNext("/tasks?view=today")).toBe("/tasks?view=today");
  });
  test("never enters the app without a verified session", () => {
    expect(googleReturnDestination(false, "/app")).toBeNull();
    expect(googleReturnDestination(true)).toBe("/app");
    expect(googleReturnDestination(true, "//evil.example")).toBe("/app");
  });
});