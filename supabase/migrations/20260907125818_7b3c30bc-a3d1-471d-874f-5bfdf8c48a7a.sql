ALTER TABLE public.sync_settings
  ADD COLUMN IF NOT EXISTS outlook_mail_sync_enabled boolean NOT NULL DEFAULT true;