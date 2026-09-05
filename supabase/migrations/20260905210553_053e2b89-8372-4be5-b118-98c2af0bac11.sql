-- Forward corrective migration for the Outlook (Microsoft Graph) feature.
-- Additive and idempotent; no earlier migration is edited.

-- 1. Canonical provider identifier: microsoft_outlook everywhere.
UPDATE public.appointments SET provider = 'microsoft_outlook' WHERE provider = 'outlook_calendar';
UPDATE public.pending_calendar_deletions SET provider = 'microsoft_outlook' WHERE provider = 'outlook_calendar';
UPDATE public.sync_state
  SET provider = 'microsoft_outlook' || substring(provider from 17)
  WHERE provider LIKE 'outlook_calendar%';

DROP VIEW IF EXISTS public.schedule_hub_events;

CREATE VIEW public.schedule_hub_events
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

REVOKE ALL ON public.schedule_hub_events FROM anon;
GRANT SELECT ON public.schedule_hub_events TO authenticated, service_role;

-- 2. Provider/account/calendar/event isolation instead of cross-provider uniqueness.
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

-- 3. Harden the deletion-queue trigger function.
CREATE OR REPLACE FUNCTION public.queue_calendar_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF OLD.calendar_event_id IS NOT NULL THEN
    INSERT INTO public.pending_calendar_deletions (user_id, calendar_event_id, provider, calendar_id)
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

-- 4. Explicit, user-controlled export of Chronos-V events to Outlook.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS export_to_outlook boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS appointments_outlook_export_idx
  ON public.appointments (user_id, starts_at)
  WHERE export_to_outlook AND calendar_event_id IS NULL;

ALTER TABLE public.sync_settings
  ADD COLUMN IF NOT EXISTS outlook_export_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS outlook_target_calendar_id text;

-- 5. Truthful sync health: attempt vs success vs incomplete.
ALTER TABLE public.sync_state
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_success_at timestamptz,
  ADD COLUMN IF NOT EXISTS incomplete boolean NOT NULL DEFAULT false;

-- 6. Revocation state so a failed disconnect is never reported as success.
ALTER TABLE public.app_user_connections
  ADD COLUMN IF NOT EXISTS revocation_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS revocation_error text,
  ADD COLUMN IF NOT EXISTS revocation_attempted_at timestamptz;