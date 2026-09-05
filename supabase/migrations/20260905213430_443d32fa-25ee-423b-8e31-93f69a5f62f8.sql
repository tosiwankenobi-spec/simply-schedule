ALTER TABLE public.plan_runs ADD COLUMN IF NOT EXISTS preview_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS plan_runs_user_preview_uidx
  ON public.plan_runs (user_id, preview_id)
  WHERE preview_id IS NOT NULL;

-- Atomic apply. Every affected row is locked and revalidated inside the same
-- transaction that writes the audit row, so a partial replan is impossible.
CREATE OR REPLACE FUNCTION public.apply_day_replan(
  p_preview_id uuid,
  p_plan_date date,
  p_moves jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_existing public.plan_runs%ROWTYPE;
  v_move jsonb;
  v_row public.appointments%ROWTYPE;
  v_task_id uuid;
  v_changes jsonb := '[]'::jsonb;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_updated int;
  v_conflicts int;
  v_run_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_moves IS NULL OR jsonb_typeof(p_moves) <> 'array' OR jsonb_array_length(p_moves) = 0 THEN
    RAISE EXCEPTION 'Choose at least one block to move.';
  END IF;
  IF jsonb_array_length(p_moves) > 20 THEN
    RAISE EXCEPTION 'That is more blocks than one plan can move.';
  END IF;

  -- Approving the same proposal twice returns the first result instead of
  -- moving anything a second time.
  SELECT * INTO v_existing
  FROM public.plan_runs
  WHERE user_id = v_user AND preview_id = p_preview_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'moved', jsonb_array_length(COALESCE(v_existing.changes, '[]'::jsonb)),
      'planRunId', v_existing.id,
      'repeated', true
    );
  END IF;

  SELECT min(LEAST((m->>'fromStart')::timestamptz, (m->>'toStart')::timestamptz)) - interval '12 hours',
         max(GREATEST((m->>'fromEnd')::timestamptz, (m->>'toEnd')::timestamptz)) + interval '12 hours'
    INTO v_window_start, v_window_end
  FROM jsonb_array_elements(p_moves) AS m;

  -- Serialize concurrent applies for this user's day before validating.
  PERFORM 1 FROM public.appointments
   WHERE user_id = v_user
     AND starts_at >= v_window_start
     AND starts_at < v_window_end
   ORDER BY id
   FOR UPDATE;

  FOR v_move IN SELECT * FROM jsonb_array_elements(p_moves)
  LOOP
    SELECT * INTO v_row
      FROM public.appointments
     WHERE id = (v_move->>'appointmentId')::uuid
       AND user_id = v_user
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Your schedule changed. Check your day again before approving.';
    END IF;
    IF (v_move->>'appointmentId')::uuid = ANY(v_ids) THEN
      RAISE EXCEPTION 'The same block cannot be moved twice in one plan.';
    END IF;
    -- A block that became a fixed commitment must never move.
    IF v_row.source <> 'task' OR v_row.commitment_type <> 'flexible' THEN
      RAISE EXCEPTION 'A protected commitment can never be moved automatically.';
    END IF;
    IF v_row.starts_at <> (v_move->>'fromStart')::timestamptz
       OR v_row.ends_at IS DISTINCT FROM (v_move->>'fromEnd')::timestamptz
       OR v_row.updated_at <> (v_move->>'version')::timestamptz THEN
      RAISE EXCEPTION 'Your schedule changed. Check your day again before approving.';
    END IF;

    SELECT id INTO v_task_id
      FROM public.tasks
     WHERE user_id = v_user
       AND scheduled_appointment_id = v_row.id
     FOR UPDATE;
    IF v_task_id IS NULL OR v_task_id <> (v_move->>'taskId')::uuid THEN
      RAISE EXCEPTION 'Your schedule changed. Check your day again before approving.';
    END IF;

    UPDATE public.appointments
       SET starts_at = (v_move->>'toStart')::timestamptz,
           ends_at = (v_move->>'toEnd')::timestamptz
     WHERE id = v_row.id
       AND user_id = v_user;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated <> 1 THEN
      RAISE EXCEPTION 'Your schedule changed. Check your day again before approving.';
    END IF;

    v_ids := v_ids || v_row.id;
    -- Audit fields are taken from the stored row, never from the request.
    v_changes := v_changes || jsonb_build_object(
      'appointmentId', v_row.id,
      'taskId', v_task_id,
      'title', v_row.title,
      'fromStart', to_char(v_row.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'fromEnd', to_char(v_row.ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'toStart', to_char((v_move->>'toStart')::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'toEnd', to_char((v_move->>'toEnd')::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'reason', CASE WHEN v_move->>'reason' = 'missed' THEN 'missed' ELSE 'conflict' END
    );
  END LOOP;

  -- With every move written, the final state must be free of overlaps.
  SELECT count(*) INTO v_conflicts
    FROM public.appointments a
    JOIN public.appointments b
      ON b.user_id = a.user_id
     AND b.id <> a.id
     AND b.is_all_day = false
     AND a.starts_at < COALESCE(b.ends_at, b.starts_at)
     AND COALESCE(a.ends_at, a.starts_at) > b.starts_at
   WHERE a.user_id = v_user
     AND a.id = ANY(v_ids)
     AND a.is_all_day = false;
  IF v_conflicts > 0 THEN
    RAISE EXCEPTION 'A new overlap appeared. Check your day again before approving.';
  END IF;

  INSERT INTO public.plan_runs (user_id, plan_date, kind, summary, changes, preview_id)
  VALUES (
    v_user,
    p_plan_date,
    'day_replan',
    jsonb_array_length(v_changes) || ' block(s) moved',
    v_changes,
    p_preview_id
  )
  RETURNING id INTO v_run_id;

  DELETE FROM public.plan_runs
   WHERE user_id = v_user
     AND applied_at < now() - interval '60 days';

  RETURN jsonb_build_object(
    'moved', jsonb_array_length(v_changes),
    'planRunId', v_run_id,
    'repeated', false,
    'changes', v_changes
  );
END;
$$;

-- Atomic undo. Blocks edited after the plan was applied are reported and left
-- exactly as they are; the audit row is closed in the same transaction.
CREATE OR REPLACE FUNCTION public.undo_plan_run(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_run public.plan_runs%ROWTYPE;
  v_change jsonb;
  v_row public.appointments%ROWTYPE;
  v_restored int := 0;
  v_already int := 0;
  v_changed int := 0;
  v_missing int := 0;
  v_updated int;
  v_lines jsonb := '[]'::jsonb;
  v_note text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_run
    FROM public.plan_runs
   WHERE id = p_run_id AND user_id = v_user
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That plan is no longer in your history.';
  END IF;
  IF v_run.undone_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'restored', 0, 'alreadyRestored', 0, 'changedSince', 0, 'missing', 0,
      'repeated', true, 'note', v_run.undo_note, 'lines', '[]'::jsonb
    );
  END IF;

  FOR v_change IN SELECT * FROM jsonb_array_elements(COALESCE(v_run.changes, '[]'::jsonb))
  LOOP
    SELECT * INTO v_row
      FROM public.appointments
     WHERE id = (v_change->>'appointmentId')::uuid
       AND user_id = v_user
       AND source = 'task'
     FOR UPDATE;

    IF NOT FOUND THEN
      v_missing := v_missing + 1;
      v_lines := v_lines || jsonb_build_object('appointmentId', v_change->>'appointmentId', 'outcome', 'missing');
    ELSIF v_row.starts_at = (v_change->>'fromStart')::timestamptz
      AND v_row.ends_at IS NOT DISTINCT FROM (v_change->>'fromEnd')::timestamptz THEN
      v_already := v_already + 1;
      v_lines := v_lines || jsonb_build_object('appointmentId', v_change->>'appointmentId', 'outcome', 'already-restored');
    ELSIF v_row.starts_at = (v_change->>'toStart')::timestamptz
      AND v_row.ends_at IS NOT DISTINCT FROM (v_change->>'toEnd')::timestamptz
      AND v_row.commitment_type = 'flexible' THEN
      UPDATE public.appointments
         SET starts_at = (v_change->>'fromStart')::timestamptz,
             ends_at = (v_change->>'fromEnd')::timestamptz
       WHERE id = v_row.id AND user_id = v_user;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated <> 1 THEN
        RAISE EXCEPTION 'That plan could not be undone. Please try again.';
      END IF;
      v_restored := v_restored + 1;
      v_lines := v_lines || jsonb_build_object('appointmentId', v_change->>'appointmentId', 'outcome', 'restored');
    ELSE
      v_changed := v_changed + 1;
      v_lines := v_lines || jsonb_build_object('appointmentId', v_change->>'appointmentId', 'outcome', 'changed-since');
    END IF;
  END LOOP;

  v_note := CASE
    WHEN v_changed + v_missing > 0
      THEN v_restored || ' put back, ' || (v_changed + v_missing) || ' left alone because they changed since.'
    ELSE v_restored || ' put back.'
  END;

  UPDATE public.plan_runs
     SET undone_at = now(), undo_note = v_note
   WHERE id = v_run.id AND user_id = v_user;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'That plan could not be undone. Please try again.';
  END IF;

  RETURN jsonb_build_object(
    'restored', v_restored,
    'alreadyRestored', v_already,
    'changedSince', v_changed,
    'missing', v_missing,
    'repeated', false,
    'note', v_note,
    'lines', v_lines
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_day_replan(uuid, date, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.undo_plan_run(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_day_replan(uuid, date, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.undo_plan_run(uuid) TO authenticated, service_role;