CREATE OR REPLACE VIEW public.schedule_hub_events
WITH (security_invoker = true) AS
SELECT
  a.id,
  a.user_id,
  a.title,
  a.notes,
  a.location,
  a.starts_at,
  a.ends_at,
  'UTC'::text AS timezone,
  (
    a.ends_at IS NOT NULL
    AND date_trunc('day', a.starts_at) = a.starts_at
    AND (EXTRACT(EPOCH FROM (a.ends_at - a.starts_at))::int % 86400) = 0
    AND a.ends_at > a.starts_at
  ) AS is_all_day,
  CASE WHEN a.calendar_event_id IS NOT NULL THEN 'fixed' ELSE 'flexible' END AS commitment_type,
  'default'::text AS privacy_level,
  CASE
    WHEN a.calendar_event_id IS NOT NULL AND a.last_synced_at IS NOT NULL THEN 'synced'
    WHEN a.calendar_event_id IS NOT NULL THEN 'pending'
    ELSE 'local'
  END AS sync_status,
  CASE
    WHEN a.calendar_event_id IS NOT NULL THEN 'google_calendar'
    WHEN a.gmail_message_id IS NOT NULL OR a.source = 'gmail' THEN 'google_mail'
    ELSE 'chronos'
  END AS provider,
  NULL::text AS provider_account_id,
  a.calendar_id,
  a.calendar_event_id,
  NULL::text AS recurrence_rule,
  a.source,
  CASE
    WHEN a.calendar_event_id IS NOT NULL THEN 'Google Calendar'
    WHEN a.gmail_message_id IS NOT NULL OR a.source = 'gmail' THEN 'Gmail'
    WHEN a.source = 'task' THEN 'Task block'
    WHEN a.source = 'quick_add' THEN 'Quick add'
    WHEN a.source = 'ai' THEN 'AI planner'
    ELSE 'Manual'
  END AS source_label,
  CASE
    WHEN a.ends_at IS NOT NULL THEN GREATEST(0, (EXTRACT(EPOCH FROM (a.ends_at - a.starts_at)) / 60)::int)
    ELSE 30
  END AS duration_min,
  a.created_at,
  a.updated_at
FROM public.appointments a;

GRANT SELECT ON public.schedule_hub_events TO authenticated;
GRANT SELECT ON public.schedule_hub_events TO service_role;