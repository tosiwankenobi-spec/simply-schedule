const SAFE_NEXT_PATH = /^\/(?!\/)/;

export function buildEmailVerificationRedirect(origin: string, next?: string): string {
  const redirect = new URL("/auth", origin);
  redirect.searchParams.set("verified", "1");
  if (next && SAFE_NEXT_PATH.test(next)) redirect.searchParams.set("next", next);
  return redirect.toString();
}

export function readAuthRedirectError(search: string, hash: string): string | null {
  const searchParams = new URLSearchParams(search);
  const hashParams = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const description =
    searchParams.get("error_description") ||
    hashParams.get("error_description") ||
    searchParams.get("error") ||
    hashParams.get("error");

  return description?.replaceAll("+", " ").trim() || null;
}
