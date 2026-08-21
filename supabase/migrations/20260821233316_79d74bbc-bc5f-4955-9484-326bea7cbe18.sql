CREATE TABLE IF NOT EXISTS public.android_oauth_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  package_name TEXT,
  debug_sha1 TEXT,
  release_sha1 TEXT,
  android_client_id TEXT,
  web_client_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.android_oauth_config TO authenticated;
GRANT ALL ON public.android_oauth_config TO service_role;
ALTER TABLE public.android_oauth_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own android oauth config" ON public.android_oauth_config;
CREATE POLICY "Users manage own android oauth config" ON public.android_oauth_config FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);