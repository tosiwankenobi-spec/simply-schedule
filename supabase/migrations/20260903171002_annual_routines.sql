ALTER TABLE public.routines
  DROP CONSTRAINT IF EXISTS routines_category_check,
  DROP CONSTRAINT IF EXISTS routines_frequency_check,
  DROP CONSTRAINT IF EXISTS routines_days_of_week_check,
  DROP CONSTRAINT IF EXISTS routines_annual_date_check,
  DROP CONSTRAINT IF EXISTS routines_birthday_check,
  ADD COLUMN IF NOT EXISTS annual_month smallint,
  ADD COLUMN IF NOT EXISTS annual_day smallint,
  ADD COLUMN IF NOT EXISTS is_all_day boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT routines_category_check
    CHECK (category IN (
      'medication', 'exercise', 'pickup', 'meal', 'household', 'bill', 'pet', 'birthday', 'other'
    )),
  ADD CONSTRAINT routines_frequency_check
    CHECK (frequency IN ('daily', 'weekly', 'yearly')),
  ADD CONSTRAINT routines_days_of_week_check
    CHECK (
      days_of_week <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[]
      AND (
        (frequency = 'yearly' AND cardinality(days_of_week) = 0)
        OR (frequency <> 'yearly' AND cardinality(days_of_week) BETWEEN 1 AND 7)
      )
    ),
  ADD CONSTRAINT routines_annual_date_check
    CHECK (
      (frequency = 'yearly'
        AND annual_month IS NOT NULL
        AND annual_day IS NOT NULL
        AND annual_month BETWEEN 1 AND 12
        AND annual_day BETWEEN 1 AND CASE
          WHEN annual_month = 2 THEN 29
          WHEN annual_month IN (4, 6, 9, 11) THEN 30
          ELSE 31
        END)
      OR (frequency <> 'yearly' AND annual_month IS NULL AND annual_day IS NULL)
    ),
  ADD CONSTRAINT routines_birthday_check
    CHECK (category <> 'birthday' OR (frequency = 'yearly' AND is_all_day));

COMMENT ON COLUMN public.routines.annual_month IS
  'Month of a yearly recurrence. Stored separately so birthdays do not require retaining a birth year.';
COMMENT ON COLUMN public.routines.annual_day IS
  'Day of a yearly recurrence. February 29 is materialized on February 28 in non-leap years.';
COMMENT ON COLUMN public.routines.is_all_day IS
  'Whether each materialized occurrence occupies its local calendar day rather than a timed slot.';

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
