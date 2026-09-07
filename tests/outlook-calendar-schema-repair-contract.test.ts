import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../supabase/migrations/20260907121238_outlook_calendar_schema_repair.sql",
  ),
  "utf8",
);
const connectorBoundary = readFileSync(
  resolve(
    import.meta.dirname,
    "../supabase/migrations/20260907121943_block_browser_connector_access.sql",
  ),
  "utf8",
);

describe("Outlook calendar live-schema repair contract", () => {
  test("keeps connector handles behind the service-role boundary", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.app_user_connections");
    expect(migration).toContain("REVOKE ALL ON public.app_user_connections FROM authenticated");
    expect(migration).toContain(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_user_connections TO service_role",
    );
    expect(migration).not.toMatch(/CREATE POLICY[^;]+app_user_connections/is);
    expect(connectorBoundary).toContain("AS RESTRICTIVE");
    expect(connectorBoundary).toContain("TO anon, authenticated");
    expect(connectorBoundary.match(/(?:USING|WITH CHECK) \(false\)/g)).toHaveLength(2);
  });

  test("restores owner-only calendar metadata and sync locks", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.outlook_calendars");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.sync_locks");
    expect(migration.match(/\(SELECT auth\.uid\(\)\) = user_id/g)).toHaveLength(10);
    expect(migration).toContain("REVOKE ALL ON public.outlook_calendars FROM anon");
    expect(migration).toContain("REVOKE ALL ON public.sync_locks FROM anon");
  });

  test("uses invoker sync RPCs with tightly scoped execution grants", () => {
    expect(migration.match(/SECURITY INVOKER/g)).toHaveLength(2);
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.claim_sync_lock(text, integer) FROM PUBLIC",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.release_sync_lock(text, uuid) FROM anon",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.claim_sync_lock(text, integer) TO authenticated, service_role",
    );
  });

  test("locks down the privileged deletion trigger", () => {
    const queueFunction = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.queue_calendar_deletion"),
      migration.indexOf("-- Provider/account/calendar/event uniqueness"),
    );
    expect(queueFunction).toContain("SECURITY DEFINER");
    expect(queueFunction).toContain("SET search_path = ''");
    expect(queueFunction).toContain(
      "REVOKE ALL ON FUNCTION public.queue_calendar_deletion() FROM authenticated",
    );
  });

  test("preserves provider isolation and the latest invoker-security timeline", () => {
    expect(migration).toContain("appointments_provider_event_uidx");
    expect(migration).toContain("pending_calendar_deletions_user_provider_event_uidx");
    expect(migration).toContain("outlook_export_enabled boolean NOT NULL DEFAULT false");
    expect(migration).toContain("last_success_at timestamptz");
    expect(migration).toContain("WITH (security_invoker = true)");
    expect(migration).toContain("WHEN a.source = 'outlook_mail' THEN 'Outlook email'");
    expect(migration).toContain("REVOKE ALL ON public.schedule_hub_events FROM anon");
  });
});
