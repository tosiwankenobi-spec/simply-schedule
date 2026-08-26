DROP INDEX IF EXISTS public.appointments_user_calendar_event_uidx;
CREATE UNIQUE INDEX appointments_user_calendar_event_uidx
  ON public.appointments (user_id, calendar_event_id);