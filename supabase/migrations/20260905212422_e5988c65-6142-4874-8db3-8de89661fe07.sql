CREATE POLICY "Users can claim their own sync locks"
  ON public.sync_locks FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can refresh their own sync locks"
  ON public.sync_locks FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can release their own sync locks"
  ON public.sync_locks FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

GRANT INSERT, UPDATE, DELETE ON public.sync_locks TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_sync_lock(p_lock_key text, p_ttl_seconds integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
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
SECURITY INVOKER
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