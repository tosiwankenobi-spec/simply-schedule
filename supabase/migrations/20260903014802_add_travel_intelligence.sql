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

COMMENT ON COLUMN public.notification_prefs.default_travel_min IS
  'User-entered default travel estimate. Chronos-V does not infer routes without an explicit mapping connection.';
COMMENT ON COLUMN public.notification_prefs.travel_buffer_min IS
  'Safety margin added to travel time when calculating leave-by guidance.';
COMMENT ON COLUMN public.appointments.travel_minutes IS
  'Optional user-entered travel estimate that overrides the account default for this appointment.';
COMMENT ON COLUMN public.appointments.preparation_minutes IS
  'Optional preparation estimate that overrides the account default for this appointment.';
