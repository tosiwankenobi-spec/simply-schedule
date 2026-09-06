-- Tighten Feature 4 grants after Supabase default table privileges are applied,
-- and evaluate auth.uid() once per query in each learning RLS policy.

REVOKE ALL ON public.learning_settings FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learning_settings TO authenticated;

REVOKE ALL ON public.learning_events FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.learning_events TO authenticated;

ALTER POLICY "Users manage their own learning settings"
  ON public.learning_settings
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

ALTER POLICY "Users read their own learning events"
  ON public.learning_events
  USING ((SELECT auth.uid()) = user_id);

ALTER POLICY "Users add their own learning events"
  ON public.learning_events
  WITH CHECK ((SELECT auth.uid()) = user_id);

ALTER POLICY "Users delete their own learning events"
  ON public.learning_events
  USING ((SELECT auth.uid()) = user_id);
