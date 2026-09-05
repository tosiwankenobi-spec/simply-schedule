CREATE TABLE public.plan_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_date date NOT NULL,
  kind text NOT NULL DEFAULT 'day_replan',
  summary text NOT NULL DEFAULT '',
  changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  applied_at timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz,
  undo_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_runs TO authenticated;
GRANT ALL ON public.plan_runs TO service_role;

ALTER TABLE public.plan_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own plan runs"
  ON public.plan_runs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users create their own plan runs"
  ON public.plan_runs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update their own plan runs"
  ON public.plan_runs FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete their own plan runs"
  ON public.plan_runs FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX plan_runs_user_applied_idx ON public.plan_runs (user_id, applied_at DESC);

CREATE TRIGGER plan_runs_set_updated_at
  BEFORE UPDATE ON public.plan_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();