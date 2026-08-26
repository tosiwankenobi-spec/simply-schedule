CREATE TABLE IF NOT EXISTS public.sync_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE UNIQUE,
  conflict_policy text NOT NULL DEFAULT 'newest',
  selected_calendar_ids text[] NOT NULL DEFAULT ARRAY['primary'],
  auto_sync_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sync_settings_conflict_policy_check
    CHECK (conflict_policy IN ('remote', 'local', 'newest'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_settings TO authenticated;
GRANT ALL ON public.sync_settings TO service_role;
ALTER TABLE public.sync_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own sync settings" ON public.sync_settings
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER sync_settings_set_updated_at BEFORE UPDATE ON public.sync_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  level text NOT NULL DEFAULT 'info',
  kind text NOT NULL,
  calendar_id text,
  message text NOT NULL,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sync_log_level_check CHECK (level IN ('info', 'warn', 'error'))
);

CREATE INDEX IF NOT EXISTS sync_log_user_created_idx ON public.sync_log (user_id, created_at DESC);

GRANT SELECT, INSERT, DELETE ON public.sync_log TO authenticated;
GRANT ALL ON public.sync_log TO service_role;
ALTER TABLE public.sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own sync log" ON public.sync_log
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.sync_state ADD COLUMN IF NOT EXISTS calendar_id text;
ALTER TABLE public.sync_state ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE public.sync_state ADD COLUMN IF NOT EXISTS pages_synced integer NOT NULL DEFAULT 0;
ALTER TABLE public.sync_state ADD COLUMN IF NOT EXISTS events_seen integer NOT NULL DEFAULT 0;

ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS calendar_id text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS remote_updated_at timestamptz;