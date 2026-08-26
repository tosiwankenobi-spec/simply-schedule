CREATE TABLE public.notification_prefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  push_enabled boolean NOT NULL DEFAULT true,
  email_enabled boolean NOT NULL DEFAULT false,
  email_to text,
  appointment_lead_min integer[] NOT NULL DEFAULT ARRAY[60, 10],
  overdue_tasks_enabled boolean NOT NULL DEFAULT true,
  overdue_grace_min integer NOT NULL DEFAULT 0,
  nudge_enabled boolean NOT NULL DEFAULT true,
  nudge_interval_min integer NOT NULL DEFAULT 120,
  quiet_start text NOT NULL DEFAULT '21:00',
  quiet_end text NOT NULL DEFAULT '07:00',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_prefs TO authenticated;
GRANT ALL ON public.notification_prefs TO service_role;
ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own notification prefs" ON public.notification_prefs
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER notification_prefs_set_updated_at BEFORE UPDATE ON public.notification_prefs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  dedupe_key text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  channels text[] NOT NULL DEFAULT ARRAY['push'],
  emailed_at timestamptz,
  seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe_key)
);

CREATE INDEX notification_log_user_created_idx ON public.notification_log (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_log TO authenticated;
GRANT ALL ON public.notification_log TO service_role;
ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own notification log" ON public.notification_log
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);