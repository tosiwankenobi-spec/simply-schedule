
CREATE TABLE public.planner_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  work_start TEXT NOT NULL DEFAULT '09:00',
  work_end TEXT NOT NULL DEFAULT '18:00',
  default_meeting_min INTEGER NOT NULL DEFAULT 30 CHECK (default_meeting_min BETWEEN 5 AND 480),
  break_every_min INTEGER NOT NULL DEFAULT 90 CHECK (break_every_min BETWEEN 15 AND 480),
  break_length_min INTEGER NOT NULL DEFAULT 10 CHECK (break_length_min BETWEEN 5 AND 120),
  lunch_at TEXT NOT NULL DEFAULT '12:30',
  lunch_length_min INTEGER NOT NULL DEFAULT 45 CHECK (lunch_length_min BETWEEN 0 AND 180),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE UNIQUE INDEX planner_profiles_one_default_per_user
  ON public.planner_profiles (user_id) WHERE is_default;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.planner_profiles TO authenticated;
GRANT ALL ON public.planner_profiles TO service_role;

ALTER TABLE public.planner_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own planner profiles"
  ON public.planner_profiles FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER planner_profiles_set_updated_at
  BEFORE UPDATE ON public.planner_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.planner_profile_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.planner_profiles(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX planner_profile_assignments_user_range
  ON public.planner_profile_assignments (user_id, start_date, end_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.planner_profile_assignments TO authenticated;
GRANT ALL ON public.planner_profile_assignments TO service_role;

ALTER TABLE public.planner_profile_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own planner assignments"
  ON public.planner_profile_assignments FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER planner_profile_assignments_set_updated_at
  BEFORE UPDATE ON public.planner_profile_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Migrate existing single-row preferences into a "Default" profile per user.
INSERT INTO public.planner_profiles
  (user_id, name, is_default, work_start, work_end, default_meeting_min,
   break_every_min, break_length_min, lunch_at, lunch_length_min, notes)
SELECT user_id, 'Default', true, work_start, work_end, default_meeting_min,
       break_every_min, break_length_min, lunch_at, lunch_length_min, notes
FROM public.planner_preferences
ON CONFLICT (user_id, name) DO NOTHING;

DROP TABLE public.planner_preferences;
