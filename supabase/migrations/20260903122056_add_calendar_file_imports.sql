-- A non-partial unique index lets PostgREST resolve idempotent file-import
-- upserts by (user_id, external_id). PostgreSQL still permits multiple NULLs.
CREATE UNIQUE INDEX IF NOT EXISTS appointments_user_external_conflict_uidx
  ON public.appointments (user_id, external_id);

COMMENT ON INDEX public.appointments_user_external_conflict_uidx IS
  'Stable deduplication key for repeat calendar-file imports.';

CREATE OR REPLACE VIEW public.schedule_hub_events
WITH (security_invoker = true) AS
SELECT
  a.id, a.user_id, a.title, a.notes, a.location, a.starts_at, a.ends_at,
  COALESCE(a.timezone, 'UTC') AS timezone, a.is_all_day, a.commitment_type,
  a.privacy_level, a.sync_status,
  COALESCE(a.provider, CASE WHEN a.calendar_event_id IS NOT NULL THEN 'google_calendar'
    WHEN a.gmail_message_id IS NOT NULL OR a.source = 'gmail' THEN 'google_mail' ELSE 'chronos' END) AS provider,
  a.provider_account_id, a.calendar_id, a.calendar_event_id, a.recurrence_rule, a.source,
  CASE WHEN a.source = 'routine' THEN 'Routine'
    WHEN a.source = 'calendar_import' AND a.provider = 'outlook_calendar' THEN 'Outlook import'
    WHEN a.source = 'calendar_import' AND a.provider = 'device_calendar' THEN 'Device calendar'
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

COMMENT ON COLUMN public.appointments.source IS
  'calendar_import rows are one-way user-approved snapshots and must never be pushed into Google Calendar automatically.';
