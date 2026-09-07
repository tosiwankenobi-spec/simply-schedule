-- Restore the Outlook calendar foundation that was present in application code
-- but missing from the live migration ledger. This migration is forward-only,
-- additive, and safe to re-run against a partially repaired database.

-- Encrypted connector handles are an application-server trust boundary. Browser
-- roles receive no privileges and no RLS policies for this table.
CREATE TABLE IF NOT EXISTS public.app_user_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connector_id text NOT NULL,
  connection_key_ciphertext text NOT NULL,
  account_label text,
  account_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revocation_pending boolean NOT NULL DEFAULT false,
  revocation_error text,
  revocation_attempted_at timestamptz
);

ALTER TABLE public.app_user_connections
  ADD COLUMN IF NOT EXISTS revocation_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS revocation_error text,
  ADD COLUMN IF NOT EXISTS revocation_attempted_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS app_user_connections_user_connector_uidx
  ON public.app_user_connections (user_id, connector_id);

ALTER TABLE public.app_user_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_user_connections FROM PUBLIC;
REVOKE ALL ON public.app_user_connections FROM anon;
REVOKE ALL ON public.app_user_connections FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_user_connections TO service_role;

DROP TRIGGER IF EXISTS app_user_connections_updated_at ON public.app_user_connections;
CREATE TRIGGER app_user_connections_updated_at
  BEFORE UPDATE ON public.app_user_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- User-owned Outlook calendar discovery and selection metadata. OAuth tokens
-- remain outside this table and never enter the browser.
CREATE TABLE IF NOT EXISTS public.outlook_calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id text NOT NULL DEFAULT 'me',
  calendar_id text NOT NULL,
  name text NOT NULL,
  color text,
  is_default boolean NOT NULL DEFAULT false,
  can_edit boolean NOT NULL DEFAULT true,
  selected boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS outlook_calendars_user_account_calendar_uidx
  ON public.outlook_calendars (user_id, account_id, calendar_id);
CREATE INDEX IF NOT EXISTS outlook_calendars_user_idx
  ON public.outlook_calendars (user_id, selected);

ALTER TABLE public.outlook_calendars ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.outlook_calendars FROM PUBLIC;
REVOKE ALL ON public.outlook_calendars FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.outlook_calendars TO authenticated;
GRANT ALL ON public.outlook_calendars TO service_role;

DROP POLICY IF EXISTS "Users manage their own Outlook calendars" ON public.outlook_calendars;
DROP POLICY IF EXISTS "Users can view their own Outlook calendars" ON public.outlook_calendars;
DROP POLICY IF EXISTS "Users can add their own Outlook calendars" ON public.outlook_calendars;
DROP POLICY IF EXISTS "Users can update their own Outlook calendars" ON public.outlook_calendars;
DROP POLICY IF EXISTS "Users can delete their own Outlook calendars" ON public.outlook_calendars;

CREATE POLICY "Users can view their own Outlook calendars"
  ON public.outlook_calendars FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can add their own Outlook calendars"
  ON public.outlook_calendars FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can update their own Outlook calendars"
  ON public.outlook_calendars FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can delete their own Outlook calendars"
  ON public.outlook_calendars FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP TRIGGER IF EXISTS outlook_calendars_updated_at ON public.outlook_calendars;
CREATE TRIGGER outlook_calendars_updated_at
  BEFORE UPDATE ON public.outlook_calendars
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Keep deletion work isolated by provider and calendar.
ALTER TABLE public.pending_calendar_deletions
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'google_calendar',
  ADD COLUMN IF NOT EXISTS calendar_id text;

ALTER TABLE public.pending_calendar_deletions
  DROP CONSTRAINT IF EXISTS pending_calendar_deletions_user_id_calendar_event_id_key;

UPDATE public.pending_calendar_deletions
SET provider = 'microsoft_outlook'
WHERE provider = 'outlook_calendar';

CREATE UNIQUE INDEX IF NOT EXISTS pending_calendar_deletions_user_provider_event_uidx
  ON public.pending_calendar_deletions (user_id, provider, calendar_event_id);

CREATE OR REPLACE FUNCTION public.queue_calendar_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF OLD.calendar_event_id IS NOT NULL THEN
    INSERT INTO public.pending_calendar_deletions (
      user_id,
      calendar_event_id,
      provider,
      calendar_id
    )
    VALUES (
      OLD.user_id,
      OLD.calendar_event_id,
      COALESCE(OLD.provider, 'google_calendar'),
      OLD.calendar_id
    )
    ON CONFLICT (user_id, provider, calendar_event_id) DO NOTHING;
  END IF;
  RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION public.queue_calendar_deletion() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.queue_calendar_deletion() FROM anon;
REVOKE ALL ON FUNCTION public.queue_calendar_deletion() FROM authenticated;

-- Provider/account/calendar/event uniqueness prevents collisions between Google,
-- Outlook, and device-calendar identifiers.
UPDATE public.appointments
SET provider = 'microsoft_outlook'
WHERE provider = 'outlook_calendar';

DROP INDEX IF EXISTS public.appointments_user_external_conflict_uidx;
DROP INDEX IF EXISTS public.appointments_user_calendar_event_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS appointments_provider_event_uidx
  ON public.appointments (
    user_id,
    COALESCE(provider, 'google_calendar'),
    COALESCE(provider_account_id, 'default'),
    COALESCE(calendar_id, 'primary'),
    calendar_event_id
  )
  WHERE calendar_event_id IS NOT NULL;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS export_to_outlook boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS appointments_outlook_export_idx
  ON public.appointments (user_id, starts_at)
  WHERE export_to_outlook AND calendar_event_id IS NULL;

ALTER TABLE public.sync_settings
  ADD COLUMN IF NOT EXISTS outlook_export_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS outlook_target_calendar_id text,
  ADD COLUMN IF NOT EXISTS outlook_mail_sync_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.sync_state
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_success_at timestamptz,
  ADD COLUMN IF NOT EXISTS incomplete boolean NOT NULL DEFAULT false;

UPDATE public.sync_state
SET provider = 'microsoft_outlook' || substring(provider from 17)
WHERE provider LIKE 'outlook_calendar%';

-- Short-lived, per-user advisory locks prevent overlapping sync runs. The RPCs
-- are security invoker functions so the table's ownership RLS remains decisive.
CREATE TABLE IF NOT EXISTS public.sync_locks (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lock_key text NOT NULL,
  token uuid NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lock_key)
);

ALTER TABLE public.sync_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sync_locks FROM PUBLIC;
REVOKE ALL ON public.sync_locks FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_locks TO authenticated;
GRANT ALL ON public.sync_locks TO service_role;

DROP POLICY IF EXISTS "Users can view their own sync locks" ON public.sync_locks;
DROP POLICY IF EXISTS "Users can claim their own sync locks" ON public.sync_locks;
DROP POLICY IF EXISTS "Users can refresh their own sync locks" ON public.sync_locks;
DROP POLICY IF EXISTS "Users can release their own sync locks" ON public.sync_locks;

CREATE POLICY "Users can view their own sync locks"
  ON public.sync_locks FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can claim their own sync locks"
  ON public.sync_locks FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can refresh their own sync locks"
  ON public.sync_locks FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can release their own sync locks"
  ON public.sync_locks FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE OR REPLACE FUNCTION public.claim_sync_lock(
  p_lock_key text,
  p_ttl_seconds integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  new_token uuid := gen_random_uuid();
  granted uuid;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_lock_key IS NULL OR char_length(p_lock_key) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'A lock name is required';
  END IF;
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 1 OR p_ttl_seconds > 3600 THEN
    RAISE EXCEPTION 'Invalid lock timeout';
  END IF;

  INSERT INTO public.sync_locks (user_id, lock_key, token, claimed_at)
  VALUES (caller_id, p_lock_key, new_token, now())
  ON CONFLICT (user_id, lock_key) DO UPDATE
    SET token = EXCLUDED.token, claimed_at = now()
    WHERE public.sync_locks.claimed_at < now() - make_interval(secs => p_ttl_seconds)
  RETURNING token INTO granted;

  RETURN granted;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_sync_lock(
  p_lock_key text,
  p_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  removed integer;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  DELETE FROM public.sync_locks
  WHERE user_id = caller_id
    AND lock_key = p_lock_key
    AND token = p_token;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed > 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_sync_lock(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_sync_lock(text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.release_sync_lock(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_sync_lock(text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_sync_lock(text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_sync_lock(text, uuid) TO authenticated, service_role;

-- Preserve the latest unified timeline shape and the Smart Inbox provider label.
CREATE OR REPLACE VIEW public.schedule_hub_events
WITH (security_invoker = true) AS
SELECT
  a.id, a.user_id, a.title, a.notes, a.location, a.starts_at, a.ends_at,
  COALESCE(a.timezone, 'UTC') AS timezone, a.is_all_day, a.commitment_type,
  a.privacy_level, a.sync_status,
  COALESCE(a.provider, CASE WHEN a.calendar_event_id IS NOT NULL THEN 'google_calendar'
    WHEN a.gmail_message_id IS NOT NULL OR a.source = 'gmail' THEN 'google_mail' ELSE 'chronos' END) AS provider,
  a.provider_account_id, a.calendar_id, a.calendar_event_id, a.recurrence_rule, a.source,
  CASE WHEN a.source = 'routine' AND a.source_metadata ->> 'routine_category' = 'birthday' THEN 'Birthday'
    WHEN a.source = 'routine' THEN 'Routine'
    WHEN a.source = 'calendar_import' AND a.provider = 'microsoft_outlook' THEN 'Outlook import'
    WHEN a.source = 'calendar_import' AND a.provider = 'device_calendar' THEN 'Device calendar'
    WHEN a.source = 'outlook_mail' THEN 'Outlook email'
    WHEN a.source IN ('microsoft_outlook', 'outlook_push') THEN 'Outlook'
    WHEN a.calendar_event_id IS NOT NULL THEN 'Google Calendar'
    WHEN a.gmail_message_id IS NOT NULL OR a.source = 'gmail' THEN 'Gmail'
    WHEN a.source = 'task' THEN 'Task block'
    WHEN a.source = 'quick_add' THEN 'Quick add'
    WHEN a.source = 'ai' THEN 'AI planner' ELSE 'Manual' END AS source_label,
  CASE WHEN a.ends_at IS NOT NULL THEN GREATEST(0, (EXTRACT(EPOCH FROM (a.ends_at - a.starts_at)) / 60)::int) ELSE 30 END AS duration_min,
  a.created_at, a.updated_at, false AS is_household_shared, NULL::text AS shared_by_name,
  a.household_id, a.household_visibility
FROM public.appointments a
UNION ALL
SELECT
  h.appointment_id, h.owner_user_id, h.title, h.notes, h.location, h.starts_at, h.ends_at,
  h.timezone, h.is_all_day, h.commitment_type, 'shared'::text, 'local'::text,
  'chronos'::text, NULL::text, NULL::text, NULL::text, h.recurrence_rule, 'household'::text,
  ('Family · ' || h.owner_display_name),
  CASE WHEN h.ends_at IS NOT NULL THEN GREATEST(0, (EXTRACT(EPOCH FROM (h.ends_at - h.starts_at)) / 60)::int) ELSE 30 END,
  h.updated_at, h.updated_at, true, h.owner_display_name, h.household_id, h.visibility
FROM public.household_events h
WHERE h.owner_user_id <> (SELECT auth.uid());

REVOKE ALL ON public.schedule_hub_events FROM PUBLIC;
REVOKE ALL ON public.schedule_hub_events FROM anon;
GRANT SELECT ON public.schedule_hub_events TO authenticated, service_role;
