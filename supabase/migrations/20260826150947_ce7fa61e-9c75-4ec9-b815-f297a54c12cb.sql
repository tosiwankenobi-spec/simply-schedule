ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS calendar_event_id text,
  ADD COLUMN IF NOT EXISTS calendar_etag text,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS appointments_user_calendar_event_uidx
  ON public.appointments (user_id, calendar_event_id)
  WHERE calendar_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.sync_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  provider text NOT NULL,
  sync_token text,
  cursor text,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_state TO authenticated;
GRANT ALL ON public.sync_state TO service_role;
ALTER TABLE public.sync_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own sync state" ON public.sync_state
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.pending_calendar_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  calendar_event_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, calendar_event_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pending_calendar_deletions TO authenticated;
GRANT ALL ON public.pending_calendar_deletions TO service_role;
ALTER TABLE public.pending_calendar_deletions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own pending deletions" ON public.pending_calendar_deletions
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.queue_calendar_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.calendar_event_id IS NOT NULL THEN
    INSERT INTO public.pending_calendar_deletions (user_id, calendar_event_id)
    VALUES (OLD.user_id, OLD.calendar_event_id)
    ON CONFLICT (user_id, calendar_event_id) DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS appointments_queue_calendar_deletion ON public.appointments;
CREATE TRIGGER appointments_queue_calendar_deletion
  AFTER DELETE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.queue_calendar_deletion();

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS sync_state_updated_at ON public.sync_state;
CREATE TRIGGER sync_state_updated_at BEFORE UPDATE ON public.sync_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();