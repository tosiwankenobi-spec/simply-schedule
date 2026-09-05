-- 1. Encrypted per-user connector keys (service-role only)
CREATE TABLE public.app_user_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connector_id text NOT NULL,
  connection_key_ciphertext text NOT NULL,
  account_label text,
  account_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, connector_id)
);

REVOKE ALL ON public.app_user_connections FROM PUBLIC;
REVOKE ALL ON public.app_user_connections FROM anon;
REVOKE ALL ON public.app_user_connections FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_user_connections TO service_role;
ALTER TABLE public.app_user_connections ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER app_user_connections_updated_at
  BEFORE UPDATE ON public.app_user_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Outlook calendar discovery / selection
CREATE TABLE public.outlook_calendars (
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
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, account_id, calendar_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.outlook_calendars TO authenticated;
GRANT ALL ON public.outlook_calendars TO service_role;
ALTER TABLE public.outlook_calendars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own Outlook calendars"
  ON public.outlook_calendars FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX outlook_calendars_user_idx ON public.outlook_calendars (user_id, selected);

CREATE TRIGGER outlook_calendars_updated_at
  BEFORE UPDATE ON public.outlook_calendars
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Provider-aware deletion queue
ALTER TABLE public.pending_calendar_deletions
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'google_calendar',
  ADD COLUMN IF NOT EXISTS calendar_id text;

ALTER TABLE public.pending_calendar_deletions
  DROP CONSTRAINT IF EXISTS pending_calendar_deletions_user_id_calendar_event_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS pending_calendar_deletions_user_provider_event_uidx
  ON public.pending_calendar_deletions (user_id, provider, calendar_event_id);

CREATE OR REPLACE FUNCTION public.queue_calendar_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

-- 4. Provider-scoped lookup index for appointments
CREATE INDEX IF NOT EXISTS appointments_provider_event_idx
  ON public.appointments (user_id, provider, provider_account_id, calendar_id, calendar_event_id)
  WHERE provider IS NOT NULL;