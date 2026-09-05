-- Atomic apply of an approved day replan.
-- Every move is revalidated inside the transaction: if any block moved,
-- changed or vanished since the proposal was shown, the whole call fails
-- and nothing changes. Re-approving the same proposal is a no-op.
CREATE OR REPLACE FUNCTION public.apply_day_replan(
  p_preview_id uuid,
  p_plan_date date,
  p_moves jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  caller_id uuid := auth.uid();
  existing public.plan_runs%ROWTYPE;
  mv jsonb;
  updated integer;
  moved_count integer := 0;
  changes jsonb := '[]'::jsonb;
  new_run_id uuid;
BEGIN
  IF caller_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_moves IS NULL OR jsonb_typeof(p_moves) <> 'array' OR jsonb_array_length(p_moves) = 0 THEN
    RAISE EXCEPTION 'Choose at least one block to move';
  END IF;
  IF jsonb_array_length(p_moves) > 20 THEN
    RAISE EXCEPTION 'Too many blocks in one update';
  END IF;

  -- Idempotency: the same approved proposal never applies twice.
  SELECT * INTO existing FROM public.plan_runs
   WHERE user_id = caller_id AND preview_id = p_preview_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'moved', jsonb_array_length(existing.changes),
      'planRunId', existing.id,
      'repeated', true
    );
  END IF;

  FOR mv IN SELECT * FROM jsonb_array_elements(p_moves) LOOP
    UPDATE public.appointments a
       SET starts_at = (mv->>'toStart')::timestamptz,
           ends_at   = (mv->>'toEnd')::timestamptz
     WHERE a.id = (mv->>'appointmentId')::uuid
       AND a.user_id = caller_id
       AND a.source = 'task'
       AND a.starts_at = (mv->>'fromStart')::timestamptz
       AND COALESCE(a.ends_at, a.starts_at) = (mv->>'fromEnd')::timestamptz
       AND a.updated_at = (mv->>'version')::timestamptz;
    GET DIAGNOSTICS updated = ROW_COUNT;
    IF updated <> 1 THEN
      RAISE EXCEPTION 'Your day changed while this update was open. Check your day again.';
    END IF;
    moved_count := moved_count + 1;
    changes := changes || jsonb_build_array(jsonb_build_object(
      'appointmentId', mv->>'appointmentId',
      'taskId',        mv->>'taskId',
      'title',         mv->>'title',
      'fromStart',     mv->>'fromStart',
      'fromEnd',       mv->>'fromEnd',
      'toStart',       mv->>'toStart',
      'toEnd',         mv->>'toEnd',
      'reason',        mv->>'reason'
    ));
  END LOOP;

  INSERT INTO public.plan_runs (user_id, plan_date, kind, summary, changes, preview_id, applied_at)
  VALUES (
    caller_id,
    p_plan_date,
    'day_replan',
    moved_count || ' task block' || CASE WHEN moved_count = 1 THEN '' ELSE 's' END || ' moved',
    changes,
    p_preview_id,
    now()
  )
  RETURNING id INTO new_run_id;

  RETURN jsonb_build_object('moved', moved_count, 'planRunId', new_run_id, 'repeated', false);
END;
$$;

-- Atomic undo: restore every block that is still exactly where the replan put
-- it, then close the history entry. Blocks changed since or deleted are left
-- untouched and reported back.
CREATE OR REPLACE FUNCTION public.undo_plan_run(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  caller_id uuid := auth.uid();
  run public.plan_runs%ROWTYPE;
  ch jsonb;
  updated integer;
  restored integer := 0;
  already integer := 0;
  changed integer := 0;
  missing integer := 0;
  note text;
BEGIN
  IF caller_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO run FROM public.plan_runs
   WHERE id = p_run_id AND user_id = caller_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That plan is no longer in your history'; END IF;

  IF run.undone_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'restored', 0, 'alreadyRestored', jsonb_array_length(run.changes),
      'changedSince', 0, 'missing', 0, 'repeated', true,
      'note', COALESCE(run.undo_note, '')
    );
  END IF;

  FOR ch IN SELECT * FROM jsonb_array_elements(run.changes) LOOP
    UPDATE public.appointments a
       SET starts_at = (ch->>'fromStart')::timestamptz,
           ends_at   = (ch->>'fromEnd')::timestamptz
     WHERE a.id = (ch->>'appointmentId')::uuid
       AND a.user_id = caller_id
       AND a.source = 'task'
       AND a.starts_at = (ch->>'toStart')::timestamptz
       AND COALESCE(a.ends_at, a.starts_at) = (ch->>'toEnd')::timestamptz;
    GET DIAGNOSTICS updated = ROW_COUNT;
    IF updated = 1 THEN
      restored := restored + 1;
    ELSIF EXISTS (
      SELECT 1 FROM public.appointments a
       WHERE a.id = (ch->>'appointmentId')::uuid AND a.user_id = caller_id
    ) THEN
      IF EXISTS (
        SELECT 1 FROM public.appointments a
         WHERE a.id = (ch->>'appointmentId')::uuid
           AND a.user_id = caller_id
           AND a.starts_at = (ch->>'fromStart')::timestamptz
      ) THEN
        already := already + 1;
      ELSE
        changed := changed + 1;
      END IF;
    ELSE
      missing := missing + 1;
    END IF;
  END LOOP;

  note := restored || ' restored'
       || CASE WHEN (changed + missing) > 0
               THEN ', ' || (changed + missing) || ' left alone because they changed since.'
               ELSE '.' END;

  UPDATE public.plan_runs
     SET undone_at = now(), undo_note = note
   WHERE id = run.id AND user_id = caller_id;

  RETURN jsonb_build_object(
    'restored', restored, 'alreadyRestored', already,
    'changedSince', changed, 'missing', missing,
    'repeated', false, 'note', note
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_day_replan(uuid, date, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.undo_plan_run(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_day_replan(uuid, date, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.undo_plan_run(uuid) TO authenticated, service_role;