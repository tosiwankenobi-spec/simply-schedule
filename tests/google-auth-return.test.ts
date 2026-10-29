import { describe, expect, test } from "vitest";
import {
  GOOGLE_NATIVE_OPEN_URL,
  googleBrowserStartUrl,
  googleNativeAppLinkUrl,
  googleNativeOpenUrl,
  googleReturnDestination,
  googleReturnUrl,
  safeAuthNext,
  validGoogleNativeReturn,
} from "../src/lib/google-auth-return";

const challenge = "A".repeat(43);
const state = "B".repeat(43);
const handoffCode = `v1.${"A".repeat(16)}.${"B".repeat(80)}.${"C".repeat(22)}`;

describe("Google native return safety (synthetic)", () => {
  test("starts OAuth from the same-origin browser with PKCE challenge and state", () => {
    const url = new URL(googleBrowserStartUrl("https://verolane.online", challenge, state));
    expect(url.origin).toBe("https://verolane.online");
    expect(url.pathname).toBe("/auth/google-start");
    expect(url.searchParams.get("challenge")).toBe(challenge);
    expect(url.searchParams.get("state")).toBe(state);
    const appLink = new URL(googleNativeAppLinkUrl("https://verolane.online", handoffCode, state));
    expect(appLink.origin).toBe("https://verolane.online");
    expect(appLink.pathname).toBe("/auth/google-handoff");
    expect(appLink.search).toBe("");
    const appLinkFragment = new URLSearchParams(appLink.hash.slice(1));
    expect(appLinkFragment.get("native")).toBe("1");
    expect(appLinkFragment.get("handoff")).toBe(handoffCode);
    expect(appLinkFragment.get("state")).toBe(state);
    expect(googleReturnUrl("https://verolane.online", true)).toBe(
      "https://verolane.online/auth/google-return?native=1",
    );
    expect(googleReturnUrl("https://verolane.online", false)).toBe(
      "https://verolane.online/auth/google-return",
    );
  });

  test("accepts only an encrypted PKCE-bound handoff in the exact native callback", () => {
    const validUrl = googleNativeOpenUrl(handoffCode, state);
    expect(validGoogleNativeReturn(validUrl)).toBe(true);
    for (const value of [
      "https://evil.example/oauth/google/return",
      GOOGLE_NATIVE_OPEN_URL,
      GOOGLE_NATIVE_OPEN_URL + "?access_token=synthetic",
      GOOGLE_NATIVE_OPEN_URL + "?handoff=synthetic&state=synthetic",
      validUrl + "&refresh_token=synthetic",
      validUrl + "#access_token=synthetic",
      "ca.verolane.chronosv://evil/google/return",
      "ca.verolane.chronosv://oauth/google/return/extra",
      "not a url",
    ]) {
      expect(validGoogleNativeReturn(value)).toBe(false);
    }
  });

  test("blocks cross-origin destinations including backslash redirects", () => {
    for (const value of [
      "//evil.example",
      "/\\\\evil.example",
      "https://evil.example",
      "/auth",
      "/\\n/evil.example",
    ]) {
      expect(safeAuthNext(value)).toBeUndefined();
    }
    expect(safeAuthNext("/tasks?view=today")).toBe("/tasks?view=today");
  });

  test("never enters the app without a verified session", () => {
    expect(googleReturnDestination(false, "/app")).toBeNull();
    expect(googleReturnDestination(true)).toBe("/app");
    expect(googleReturnDestination(true, "//evil.example")).toBe("/app");
  });
});
