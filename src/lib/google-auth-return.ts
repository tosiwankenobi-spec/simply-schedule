/** Safe routing helpers for browser OAuth and the native PKCE handoff. */
export const GOOGLE_NATIVE_OPEN_URL = "ca.verolane.chronosv://oauth/google/return";
export const GOOGLE_NATIVE_VERIFIER_KEY = "chronos-v:google-native-verifier";
export const GOOGLE_NATIVE_STATE_KEY = "chronos-v:google-native-state";
export const GOOGLE_NATIVE_NEXT_KEY = "chronos-google-next";
export const GOOGLE_BROWSER_CHALLENGE_KEY = "chronos-v:google-browser-challenge";
export const GOOGLE_BROWSER_STATE_KEY = "chronos-v:google-browser-state";

const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const HANDOFF_CODE = /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{1,1500}\.[A-Za-z0-9_-]{22}$/;

export function safeAuthNext(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return;
  if ([...value].some((char) => char === "\\" || char.charCodeAt(0) <= 0x20)) return;
  try {
    const parsed = new URL(value, "https://verolane.online");
    if (parsed.origin !== "https://verolane.online" || parsed.pathname.startsWith("/auth")) return;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch { return; }
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function createNativeGooglePkce(): Promise<{
  verifier: string;
  challenge: string;
  state: string;
}> {
  if (!globalThis.crypto?.subtle) throw new Error("Secure sign-in is unavailable on this device.");
  const random = (size: number) => {
    const bytes = new Uint8Array(size);
    globalThis.crypto.getRandomValues(bytes);
    return base64Url(bytes);
  };
  const verifier = random(32);
  const state = random(32);
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return { verifier, state, challenge: base64Url(new Uint8Array(digest)) };
}

export function isValidNativeGoogleChallenge(value: unknown): value is string {
  return typeof value === "string" && PKCE_CHALLENGE.test(value);
}

export function isValidNativeGoogleState(value: unknown): value is string {
  return typeof value === "string" && PKCE_CHALLENGE.test(value);
}

export function isValidNativeHandoffCode(value: unknown): value is string {
  return typeof value === "string" && value.length <= 1800 && HANDOFF_CODE.test(value);
}

export function googleBrowserStartUrl(origin: string, challenge: string, state: string): string {
  if (!isValidNativeGoogleChallenge(challenge) || !isValidNativeGoogleState(state)) {
    throw new Error("Invalid native Google sign-in request.");
  }
  const url = new URL("/auth/google-start", origin);
  // Keep PKCE material out of the HTTP request URL and server access logs.
  url.hash = new URLSearchParams({ challenge, state }).toString();
  return url.toString();
}

export function googleReturnUrl(origin: string, native: boolean): string {
  const url = new URL("/auth/google-return", origin);
  if (native) url.searchParams.set("native", "1");
  return url.toString();
}

export function googleNativeOpenUrl(handoffCode: string, state: string): string {
  if (!isValidNativeHandoffCode(handoffCode) || !isValidNativeGoogleState(state)) {
    throw new Error("Invalid native Google handoff.");
  }
  const url = new URL(GOOGLE_NATIVE_OPEN_URL);
  url.searchParams.set("handoff", handoffCode);
  url.searchParams.set("state", state);
  return url.toString();
}

export function googleNativeAppLinkUrl(origin: string, handoffCode: string, state: string): string {
  if (!isValidNativeHandoffCode(handoffCode) || !isValidNativeGoogleState(state)) {
    throw new Error("Invalid native Google handoff.");
  }
  const url = new URL("/auth/google-handoff", origin);
  // Put the opaque handoff in the fragment so web/CDN request logs never see it.
  url.hash = new URLSearchParams({
    native: "1",
    handoff: handoffCode,
    state,
  }).toString();
  return url.toString();
}

export function validGoogleNativeReturn(value: string): boolean {
  try {
    const url = new URL(value);
    const keys = Array.from(url.searchParams.keys());
    return url.protocol === "ca.verolane.chronosv:" &&
      url.hostname === "oauth" &&
      url.pathname === "/google/return" &&
      !url.hash && !url.username && !url.password && !url.port &&
      keys.length === 2 &&
      keys.every((key) => key === "handoff" || key === "state") &&
      url.searchParams.getAll("handoff").length === 1 &&
      url.searchParams.getAll("state").length === 1 &&
      isValidNativeHandoffCode(url.searchParams.get("handoff")) &&
      isValidNativeGoogleState(url.searchParams.get("state"));
  } catch { return false; }
}

export function googleReturnDestination(hasVerifiedUser: boolean, next?: unknown): string | null {
  return hasVerifiedUser ? safeAuthNext(next) ?? "/app" : null;
}
