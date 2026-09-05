/**
 * Server-only storage for per-user connector connection keys.
 * The key is stored encrypted; only service-role code can read the table.
 */
import { encryptConnectionKey, decryptConnectionKey } from "./connectionKeyCrypto";

export async function saveConnectionKeyForUser(
  userId: string,
  connectorId: string,
  connectionAPIKey: string,
  accountLabel?: string | null,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("app_user_connections").upsert(
    {
      user_id: userId,
      connector_id: connectorId,
      connection_key_ciphertext: encryptConnectionKey(connectionAPIKey),
      account_label: accountLabel ?? null,
      revocation_pending: false,
      revocation_error: null,
      revocation_attempted_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,connector_id" },
  );
  if (error) throw new Error("Could not save the Microsoft connection.");
}

export async function getConnectionKeyForUser(
  userId: string,
  connectorId: string,
): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("app_user_connections")
    .select("connection_key_ciphertext")
    .eq("user_id", userId)
    .eq("connector_id", connectorId)
    .maybeSingle();
  if (error) throw new Error("Could not read the Microsoft connection.");
  if (!data) return null;
  try {
    return decryptConnectionKey(data.connection_key_ciphertext);
  } catch {
    return null;
  }
}

export async function getConnectionMetaForUser(userId: string, connectorId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_user_connections")
    .select(
      "account_label, created_at, updated_at, revocation_pending, revocation_error, revocation_attempted_at",
    )
    .eq("user_id", userId)
    .eq("connector_id", connectorId)
    .maybeSingle();
  return data ?? null;
}

export async function deleteConnectionForUser(userId: string, connectorId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("app_user_connections")
    .delete()
    .eq("user_id", userId)
    .eq("connector_id", connectorId);
  if (error) throw new Error("The stored connection could not be removed. Please try again.");
}

/**
 * Records that revoking access with the provider did not succeed, so the
 * stored handle is kept and the person can retry instead of leaving an
 * active remote authorization behind.
 */
export async function markRevocationState(
  userId: string,
  connectorId: string,
  state: { pending: boolean; error?: string | null },
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("app_user_connections")
    .update({
      revocation_pending: state.pending,
      revocation_error: state.error ?? null,
      revocation_attempted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("connector_id", connectorId);
  if (error) throw new Error("The connection status could not be updated. Please try again.");
}

export async function updateConnectionLabel(
  userId: string,
  connectorId: string,
  accountLabel: string | null,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("app_user_connections")
    .update({ account_label: accountLabel, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("connector_id", connectorId);
  if (error) throw new Error("The connection details could not be updated.");
}
