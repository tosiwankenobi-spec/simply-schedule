ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS is_all_day boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS commitment_type text NOT NULL DEFAULT 'flexible',
  ADD COLUMN IF NOT EXISTS privacy_level text NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_account_id text,
  ADD COLUMN IF NOT EXISTS recurrence_rule text,
  ADD COLUMN IF NOT EXISTS source_metadata jsonb;

ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_commitment_type_check,
  ADD CONSTRAINT appointments_commitment_type_check
    CHECK (commitment_type IN ('fixed', 'flexible'));

UPDATE public.appointments
SET commitment_type = 'fixed',
    sync_status = CASE WHEN last_synced_at IS NOT NULL THEN 'synced' ELSE 'pending' END,
    provider = COALESCE(provider, 'google_calendar')
WHERE calendar_event_id IS NOT NULL;

ALTER TABLE public.notification_prefs
  ADD COLUMN travel_reminders_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN travel_mode text NOT NULL DEFAULT 'driving',
  ADD COLUMN default_travel_min integer NOT NULL DEFAULT 30,
  ADD COLUMN travel_buffer_min integer NOT NULL DEFAULT 10,
  ADD COLUMN default_prep_min integer NOT NULL DEFAULT 10;

ALTER TABLE public.notification_prefs
  ADD CONSTRAINT notification_prefs_travel_mode_check
    CHECK (travel_mode IN ('driving', 'transit', 'walking', 'cycling', 'other')),
  ADD CONSTRAINT notification_prefs_default_travel_min_check
    CHECK (default_travel_min BETWEEN 1 AND 240),
  ADD CONSTRAINT notification_prefs_travel_buffer_min_check
    CHECK (travel_buffer_min BETWEEN 0 AND 120),
  ADD CONSTRAINT notification_prefs_default_prep_min_check
    CHECK (default_prep_min BETWEEN 0 AND 240);

ALTER TABLE public.appointments
  ADD COLUMN travel_minutes integer,
  ADD COLUMN preparation_minutes integer;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_travel_minutes_check
    CHECK (travel_minutes IS NULL OR travel_minutes BETWEEN 1 AND 720),
  ADD CONSTRAINT appointments_preparation_minutes_check
    CHECK (preparation_minutes IS NULL OR preparation_minutes BETWEEN 0 AND 240);

CREATE TABLE public.routines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  category text NOT NULL DEFAULT 'other',
  frequency text NOT NULL DEFAULT 'weekly',
  days_of_week smallint[] NOT NULL DEFAULT ARRAY[1]::smallint[],
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
  annual_month smallint,
  annual_day smallint,
  is_all_day boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT routines_category_check
    CHECK (category IN (
      'medication', 'exercise', 'pickup', 'meal', 'household', 'bill', 'pet', 'birthday', 'other'
    )),
  CONSTRAINT routines_frequency_check
    CHECK (frequency IN ('daily', 'weekly', 'yearly')),
  CONSTRAINT routines_days_of_week_check
    CHECK (
      days_of_week <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[]
      AND (
        (frequency = 'yearly' AND cardinality(days_of_week) = 0)
        OR (frequency <> 'yearly' AND cardinality(days_of_week) BETWEEN 1 AND 7)
      )
    ),
  CONSTRAINT routines_annual_date_check
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
  CONSTRAINT routines_birthday_check
    CHECK (category <> 'birthday' OR (frequency = 'yearly' AND is_all_day))
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