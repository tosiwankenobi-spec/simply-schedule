ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS gmail_thread_id text,
  ADD COLUMN IF NOT EXISTS gmail_message_id text,
  ADD COLUMN IF NOT EXISTS gmail_from text,
  ADD COLUMN IF NOT EXISTS gmail_subject text,
  ADD COLUMN IF NOT EXISTS gmail_reply_state text,
  ADD COLUMN IF NOT EXISTS gmail_replied_at timestamptz;

ALTER TABLE public.sync_settings
  ADD COLUMN IF NOT EXISTS gmail_sync_enabled boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS appointments_gmail_thread_idx
  ON public.appointments (user_id, gmail_thread_id);