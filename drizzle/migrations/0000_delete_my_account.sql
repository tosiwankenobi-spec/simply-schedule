CREATE OR REPLACE FUNCTION public.delete_my_account()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  DELETE FROM public.households WHERE owner_user_id = v_user;
  DELETE FROM public.household_members WHERE user_id = v_user;
  DELETE FROM public.notification_log WHERE user_id = v_user;
  DELETE FROM public.notification_prefs WHERE user_id = v_user;
  DELETE FROM public.plan_runs WHERE user_id = v_user;
  DELETE FROM public.appointments WHERE user_id = v_user;
  DELETE FROM public.tasks WHERE user_id = v_user;
  DELETE FROM public.routines WHERE user_id = v_user;
  DELETE FROM public.planner_profile_assignments WHERE user_id = v_user;
  DELETE FROM public.planner_profiles WHERE user_id = v_user;
  DELETE FROM public.learning_events WHERE user_id = v_user;
  DELETE FROM public.learning_settings WHERE user_id = v_user;
  DELETE FROM public.sync_settings WHERE user_id = v_user;
  DELETE FROM public.sync_state WHERE user_id = v_user;
  DELETE FROM public.sync_locks WHERE user_id = v_user;
  DELETE FROM public.outlook_calendars WHERE user_id = v_user;
  DELETE FROM public.app_user_connections WHERE user_id = v_user;
  DELETE FROM public.pending_calendar_deletions WHERE user_id = v_user;
  DELETE FROM public.verification_documents WHERE user_id = v_user;

  RETURN jsonb_build_object('deleted', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;