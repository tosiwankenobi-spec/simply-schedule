const MANAGED_PUBLIC_ENV = [
  ["SUPABASE_URL", "VITE_SUPABASE_URL"],
  ["SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY"],
  ["SUPABASE_PROJECT_ID", "VITE_SUPABASE_PROJECT_ID"],
] as const;

/**
 * Lovable Cloud provides Supabase configuration as server environment variables.
 * Vite only exposes VITE_* variables to browser code, so mirror the explicitly
 * public values at build time. Privileged values such as the service-role key are
 * intentionally not included.
 */
export function managedPublicEnvDefines(
  env: Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    MANAGED_PUBLIC_ENV.flatMap(([source, target]) => {
      const value = env[source]?.trim();
      return value ? [[`import.meta.env.${target}`, JSON.stringify(value)]] : [];
    }),
  );
}
