-- Feature 4: opt-in, privacy-first learning layer.
-- Forward-only additive migration: one settings row per user plus compact,
-- allowlisted decision events. No free text or schedule-item identifiers.

-- 1. Per-user learning settings ------------------------------------------------
CREATE TABLE public.learning_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  accepted_conflict_strategy text
    CHECK (accepted_conflict_strategy IN ('shift', 'skip', 'force')),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT learning_settings_accepted_pair CHECK (
    (accepted_conflict_strategy IS NULL AND accepted_at IS NULL)
    OR (accepted_conflict_strategy IS NOT NULL AND accepted_at IS NOT NULL)
  )
);

REVOKE ALL ON public.learning_settings FROM PUBLIC;
REVOKE ALL ON public.learning_settings FROM anon;
REVOKE ALL ON public.learning_settings FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learning_settings TO authenticated;
GRANT ALL ON public.learning_settings TO service_role;

ALTER TABLE public.learning_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own learning settings"
  ON public.learning_settings FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE TRIGGER learning_settings_set_updated_at
  BEFORE UPDATE ON public.learning_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Compact decision events ----------------------------------------------------
CREATE TABLE public.learning_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('plan_applied', 'replan_applied', 'undo_completed')),
  conflict_strategy text CHECK (conflict_strategy IN ('shift', 'skip', 'force')),
  offered_count integer NOT NULL DEFAULT 0 CHECK (offered_count BETWEEN 0 AND 500),
  approved_count integer NOT NULL DEFAULT 0 CHECK (approved_count BETWEEN 0 AND 500),
  moved_count integer NOT NULL DEFAULT 0 CHECK (moved_count BETWEEN 0 AND 500),
  restored_count integer NOT NULL DEFAULT 0 CHECK (restored_count BETWEEN 0 AND 500),
  left_alone_count integer NOT NULL DEFAULT 0 CHECK (left_alone_count BETWEEN 0 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT learning_events_strategy_required CHECK (
    (kind = 'plan_applied' AND conflict_strategy IS NOT NULL)
    OR (kind <> 'plan_applied' AND conflict_strategy IS NULL)
  ),
  CONSTRAINT learning_events_count_relationships CHECK (
    approved_count <= offered_count AND moved_count <= approved_count
  ),
  CONSTRAINT learning_events_kind_shape CHECK (
    (kind IN ('plan_applied', 'replan_applied')
      AND restored_count = 0 AND left_alone_count = 0)
    OR (kind = 'undo_completed'
      AND offered_count = 0 AND approved_count = 0 AND moved_count = 0)
  )
);

REVOKE ALL ON public.learning_events FROM PUBLIC;
REVOKE ALL ON public.learning_events FROM anon;
REVOKE ALL ON public.learning_events FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.learning_events TO authenticated;
GRANT ALL ON public.learning_events TO service_role;

ALTER TABLE public.learning_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own learning events"
  ON public.learning_events FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users add their own learning events"
  ON public.learning_events FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users delete their own learning events"
  ON public.learning_events FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE INDEX learning_events_user_created_idx
  ON public.learning_events (user_id, created_at DESC);

-- 3. Recording RPC: validates, honours the opt-in switch, prunes old rows -------
CREATE OR REPLACE FUNCTION public.record_learning_event(
  p_kind text,
  p_conflict_strategy text DEFAULT NULL,
  p_offered integer DEFAULT 0,
  p_approved integer DEFAULT 0,
  p_moved integer DEFAULT 0,
  p_restored integer DEFAULT 0,
  p_left_alone integer DEFAULT 0
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_enabled boolean;
BEGIN
  IF v_user IS NULL THEN
    RETURN false;
  END IF;

  SELECT enabled INTO v_enabled FROM public.learning_settings WHERE user_id = v_user;
  IF v_enabled IS DISTINCT FROM true THEN
    RETURN false; -- learning is off: record nothing
  END IF;

  IF p_kind NOT IN ('plan_applied', 'replan_applied', 'undo_completed') THEN
    RETURN false;
  END IF;

  IF p_kind = 'plan_applied' THEN
    IF p_conflict_strategy IS NULL OR p_conflict_strategy NOT IN ('shift', 'skip', 'force') THEN
      RETURN false;
    END IF;
  ELSIF p_conflict_strategy IS NOT NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.learning_events (
    user_id, kind, conflict_strategy,
    offered_count, approved_count, moved_count, restored_count, left_alone_count
  ) VALUES (
    v_user, p_kind, p_conflict_strategy,
    LEAST(GREATEST(COALESCE(p_offered, 0), 0), 500),
    LEAST(GREATEST(COALESCE(p_approved, 0), 0), 500),
    LEAST(GREATEST(COALESCE(p_moved, 0), 0), 500),
    LEAST(GREATEST(COALESCE(p_restored, 0), 0), 500),
    LEAST(GREATEST(COALESCE(p_left_alone, 0), 0), 500)
  );

  -- bounded retention: 180 days, own rows only
  DELETE FROM public.learning_events
  WHERE user_id = v_user AND created_at < now() - interval '180 days';

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_learning_event(text, text, integer, integer, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_learning_event(text, text, integer, integer, integer, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_learning_event(text, text, integer, integer, integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_learning_event(text, text, integer, integer, integer, integer, integer) TO service_role;

-- 4. Reset RPC: learning history + accepted default only ------------------------
CREATE OR REPLACE FUNCTION public.reset_learning_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_deleted integer := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  WITH removed AS (
    DELETE FROM public.learning_events WHERE user_id = v_user RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM removed;

  UPDATE public.learning_settings
  SET accepted_conflict_strategy = NULL, accepted_at = NULL
  WHERE user_id = v_user;

  RETURN jsonb_build_object('deletedEvents', v_deleted);
END;
$$;

REVOKE ALL ON FUNCTION public.reset_learning_data() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_learning_data() FROM anon;
GRANT EXECUTE ON FUNCTION public.reset_learning_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_learning_data() TO service_role;

-- 5. Enforce the retention promise even when a user stops opening the app. -------
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

SELECT cron.schedule(
  'chronos_v_purge_learning_events',
  '17 3 * * *',
  $$DELETE FROM public.learning_events WHERE created_at < now() - interval '180 days'$$
);
