ALTER TABLE public.notification_log
  ADD COLUMN IF NOT EXISTS target_type text,
  ADD COLUMN IF NOT EXISTS target_id uuid,
  ADD COLUMN IF NOT EXISTS snoozed_until timestamptz,
  ADD COLUMN IF NOT EXISTS acted_at timestamptz,
  ADD COLUMN IF NOT EXISTS action_taken text;

ALTER TABLE public.notification_log
  DROP CONSTRAINT IF EXISTS notification_log_target_type_check,
  DROP CONSTRAINT IF EXISTS notification_log_action_taken_check;

ALTER TABLE public.notification_log
  ADD CONSTRAINT notification_log_target_type_check
    CHECK (target_type IS NULL OR target_type IN ('task', 'appointment', 'planner')),
  ADD CONSTRAINT notification_log_action_taken_check
    CHECK (
      action_taken IS NULL OR action_taken IN (
        'done', 'snooze', 'reschedule', 'review_plan', 'open_navigation', 'open', 'dismiss'
      )
    );

-- Preserve useful actions for reminder rows created before this migration.
UPDATE public.notification_log
SET
  target_type = 'appointment',
  target_id = substring(
    dedupe_key FROM '^appt:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):'
  )::uuid
WHERE target_type IS NULL
  AND dedupe_key ~ '^appt:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:';

UPDATE public.notification_log
SET
  target_type = 'task',
  target_id = substring(
    dedupe_key FROM '^overdue:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):'
  )::uuid
WHERE target_type IS NULL
  AND dedupe_key ~ '^overdue:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:';

UPDATE public.notification_log
SET target_type = 'planner'
WHERE target_type IS NULL
  AND kind = 'nudge';

CREATE INDEX IF NOT EXISTS notification_log_unseen_idx
  ON public.notification_log (user_id, snoozed_until, created_at DESC)
  WHERE seen_at IS NULL;

REVOKE ALL ON public.notification_log FROM PUBLIC;
REVOKE ALL ON public.notification_log FROM anon;
REVOKE ALL ON public.notification_log FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.notification_log TO authenticated;
GRANT ALL ON public.notification_log TO service_role;

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own notification log" ON public.notification_log;
DROP POLICY IF EXISTS "Users read their own notification log" ON public.notification_log;
DROP POLICY IF EXISTS "Users create their own notification log" ON public.notification_log;
DROP POLICY IF EXISTS "Users update their own notification log" ON public.notification_log;

CREATE POLICY "Users read their own notification log"
  ON public.notification_log FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users create their own notification log"
  ON public.notification_log FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users update their own notification log"
  ON public.notification_log FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE OR REPLACE FUNCTION public.act_on_notification(
  p_notification_id uuid,
  p_action text,
  p_snooze_minutes integer DEFAULT 15
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_notification public.notification_log%ROWTYPE;
  v_location text;
  v_snoozed_until timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_action NOT IN (
    'done', 'snooze', 'reschedule', 'review_plan', 'open_navigation', 'open', 'dismiss'
  ) THEN
    RAISE EXCEPTION 'Unsupported notification action';
  END IF;

  SELECT *
  INTO v_notification
  FROM public.notification_log
  WHERE id = p_notification_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notification not found';
  END IF;

  IF p_action = 'done' THEN
    IF v_notification.target_type <> 'task' OR v_notification.target_id IS NULL THEN
      RAISE EXCEPTION 'This reminder cannot be completed';
    END IF;

    UPDATE public.tasks
    SET status = 'done'
    WHERE id = v_notification.target_id
      AND user_id = v_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Task not found';
    END IF;
  ELSIF p_action = 'snooze' THEN
    IF p_snooze_minutes < 5 OR p_snooze_minutes > 1440 THEN
      RAISE EXCEPTION 'Snooze must be between 5 minutes and 24 hours';
    END IF;
    v_snoozed_until := now() + make_interval(mins => p_snooze_minutes);
  ELSIF p_action = 'open_navigation' THEN
    IF v_notification.target_type <> 'appointment' OR v_notification.target_id IS NULL THEN
      RAISE EXCEPTION 'This reminder has no appointment destination';
    END IF;

    SELECT location
    INTO v_location
    FROM public.appointments
    WHERE id = v_notification.target_id
      AND user_id = v_user_id;

    IF v_location IS NULL OR btrim(v_location) = '' THEN
      RAISE EXCEPTION 'This appointment has no location';
    END IF;
  END IF;

  UPDATE public.notification_log
  SET
    snoozed_until = CASE
      WHEN p_action = 'snooze' THEN v_snoozed_until
      ELSE NULL
    END,
    seen_at = CASE WHEN p_action = 'snooze' THEN NULL ELSE now() END,
    acted_at = now(),
    action_taken = p_action
  WHERE id = v_notification.id
    AND user_id = v_user_id;

  RETURN jsonb_build_object(
    'notificationId', v_notification.id,
    'action', p_action,
    'targetType', v_notification.target_type,
    'targetId', v_notification.target_id,
    'location', v_location,
    'snoozedUntil', v_snoozed_until
  );
END;
$$;

REVOKE ALL ON FUNCTION public.act_on_notification(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.act_on_notification(uuid, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.act_on_notification(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.act_on_notification(uuid, text, integer) TO service_role;