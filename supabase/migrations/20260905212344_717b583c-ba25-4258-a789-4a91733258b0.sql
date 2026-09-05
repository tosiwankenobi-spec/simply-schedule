CREATE TABLE IF NOT EXISTS public.sync_locks (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lock_key text NOT NULL,
  token uuid NOT NULL,
  claimed_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lock_key)
);

GRANT SELECT ON public.sync_locks TO authenticated;
GRANT ALL ON public.sync_locks TO service_role;

ALTER TABLE public.sync_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own sync locks"
  ON public.sync_locks FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.claim_sync_lock(p_lock_key text, p_ttl_seconds integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  caller_id uuid := auth.uid();
  new_token uuid := gen_random_uuid();
  granted uuid;
BEGIN
  IF caller_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_lock_key IS NULL OR char_length(p_lock_key) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'A lock name is required';
  END IF;
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 1 OR p_ttl_seconds > 3600 THEN
    RAISE EXCEPTION 'Invalid lock timeout';
  END IF;

  INSERT INTO public.sync_locks (user_id, lock_key, token, claimed_at)
  VALUES (caller_id, p_lock_key, new_token, now())
  ON CONFLICT (user_id, lock_key) DO UPDATE
    SET token = EXCLUDED.token, claimed_at = now()
    WHERE public.sync_locks.claimed_at < now() - make_interval(secs => p_ttl_seconds)
  RETURNING token INTO granted;

  RETURN granted;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_sync_lock(p_lock_key text, p_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  caller_id uuid := auth.uid();
  removed integer;
BEGIN
  IF caller_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  DELETE FROM public.sync_locks
  WHERE user_id = caller_id AND lock_key = p_lock_key AND token = p_token;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_sync_lock(text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.release_sync_lock(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_sync_lock(text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_sync_lock(text, uuid) TO authenticated, service_role;