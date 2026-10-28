/** Browser-safe routing only. Never transfers credentials between browser and WebView. */
export const GOOGLE_NATIVE_OPEN_URL = "ca.verolane.chronosv://oauth/google/return";

export function safeAuthNext(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return;
  if (/[\\\u0000-\u0020]/.test(value)) return;
  try {
    const parsed = new URL(value, "https://verolane.online");
    if (parsed.origin !== "https://verolane.online" || parsed.pathname.startsWith("/auth")) return;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch { return; }
}

export function googleBrowserStartUrl(origin: string): string {
  return new URL("/auth/google-start", origin).toString();
}

export function googleReturnUrl(origin: string, native: boolean): string {
  const url = new URL("/auth/google-return", origin);
  if (native) url.searchParams.set("native", "1");
  return url.toString();
}

export function validGoogleNativeReturn(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "ca.verolane.chronosv:" && url.hostname === "oauth" &&
      url.pathname === "/google/return" && !url.search && !url.hash && !url.username && !url.password && !url.port;
  } catch { return false; }
}

export function googleReturnDestination(hasVerifiedUser: boolean, next?: unknown): string | null {
  return hasVerifiedUser ? safeAuthNext(next) ?? "/app" : null;
}