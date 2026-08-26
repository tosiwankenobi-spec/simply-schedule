ALTER TABLE public.android_oauth_config
ADD COLUMN IF NOT EXISTS play_sha1 TEXT;