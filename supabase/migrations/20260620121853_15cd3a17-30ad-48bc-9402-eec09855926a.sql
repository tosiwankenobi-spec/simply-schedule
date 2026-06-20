
CREATE TABLE public.planner_preferences (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  work_start TEXT NOT NULL DEFAULT '09:00',
  work_end TEXT NOT NULL DEFAULT '18:00',
  default_meeting_min INTEGER NOT NULL DEFAULT 30 CHECK (default_meeting_min BETWEEN 5 AND 480),
  break_every_min INTEGER NOT NULL DEFAULT 90 CHECK (break_every_min BETWEEN 15 AND 480),
  break_length_min INTEGER NOT NULL DEFAULT 10 CHECK (break_length_min BETWEEN 5 AND 120),
  lunch_at TEXT NOT NULL DEFAULT '12:30',
  lunch_length_min INTEGER NOT NULL DEFAULT 45 CHECK (lunch_length_min BETWEEN 0 AND 180),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.planner_preferences TO authenticated;
GRANT ALL ON public.planner_preferences TO service_role;

ALTER TABLE public.planner_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own planner prefs"
  ON public.planner_preferences FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER planner_prefs_set_updated_at
  BEFORE UPDATE ON public.planner_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
