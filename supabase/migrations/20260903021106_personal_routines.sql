CREATE TABLE public.routines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('medication', 'exercise', 'pickup', 'meal', 'household', 'bill', 'pet', 'other')),
  frequency text NOT NULL DEFAULT 'weekly'
    CHECK (frequency IN ('daily', 'weekly')),
  days_of_week smallint[] NOT NULL DEFAULT ARRAY[1]::smallint[]
    CHECK (
      cardinality(days_of_week) BETWEEN 1 AND 7
      AND days_of_week <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[]
    ),
  local_time time NOT NULL,
  duration_min integer NOT NULL DEFAULT 30 CHECK (duration_min BETWEEN 5 AND 480),
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  timezone text NOT NULL DEFAULT 'UTC' CHECK (char_length(timezone) BETWEEN 1 AND 100),
  location text CHECK (location IS NULL OR char_length(location) <= 200),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  commitment_type text NOT NULL DEFAULT 'fixed'
    CHECK (commitment_type IN ('fixed', 'flexible')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);

REVOKE ALL ON public.routines FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.routines TO authenticated;
GRANT ALL ON public.routines TO service_role;

ALTER TABLE public.routines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own routines"
  ON public.routines FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can create own routines"
  ON public.routines FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own routines"
  ON public.routines FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete own routines"
  ON public.routines FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE TRIGGER routines_set_updated_at
  BEFORE UPDATE ON public.routines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX routines_user_active_idx
  ON public.routines (user_id, active, start_date);

ALTER TABLE public.appointments
  ADD COLUMN routine_id uuid REFERENCES public.routines(id) ON DELETE SET NULL,
  ADD COLUMN routine_occurrence_date date;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_routine_occurrence_key
  UNIQUE (routine_id, routine_occurrence_date);

CREATE INDEX appointments_user_routine_idx
  ON public.appointments (user_id, routine_id, starts_at)
  WHERE routine_id IS NOT NULL;

COMMENT ON TABLE public.routines IS
  'User-owned recurring life commitments. A rolling window is materialized into appointments for the unified timeline.';
COMMENT ON COLUMN public.routines.timezone IS
  'IANA timezone used to preserve the intended local wall-clock time across daylight-saving changes.';
COMMENT ON COLUMN public.appointments.routine_occurrence_date IS
  'Local calendar date for a materialized routine occurrence; unique within its routine.';

DROP VIEW IF EXISTS public.schedule_hub_events;

CREATE VIEW public.schedule_hub_events
WITH (security_invoker = true) AS
SELECT
  a.id,
  a.user_id,
  a.title,
  a.notes,
  a.location,
  a.starts_at,
  a.ends_at,
  COALESCE(a.timezone, 'UTC') AS timezone,
  a.is_all_day,
  a.commitment_type,
  a.privacy_level,
  a.sync_status,
  COALESCE(
    a.provider,
    CASE
      WHEN a.calendar_event_id IS NOT NULL THEN 'google_calendar'
      WHEN a.gmail_message_id IS NOT NULL OR a.source = 'gmail' THEN 'google_mail'
      ELSE 'chronos'
    END
  ) AS provider,
  a.provider_account_id,
  a.calendar_id,
  a.calendar_event_id,
  a.recurrence_rule,
  a.source,
  CASE
    WHEN a.source = 'routine' THEN 'Routine'
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

REVOKE ALL ON public.schedule_hub_events FROM anon;
GRANT SELECT ON public.schedule_hub_events TO authenticated;
GRANT SELECT ON public.schedule_hub_events TO service_role;
