CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;

CREATE TABLE public.households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.household_members (
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, user_id)
);

CREATE TABLE public.household_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  max_uses integer NOT NULL DEFAULT 5 CHECK (max_uses BETWEEN 1 AND 20),
  used_count integer NOT NULL DEFAULT 0 CHECK (used_count >= 0 AND used_count <= max_uses),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.appointments
  ADD COLUMN household_id uuid REFERENCES public.households(id) ON DELETE SET NULL,
  ADD COLUMN household_visibility text NOT NULL DEFAULT 'private'
    CHECK (household_visibility IN ('private', 'busy', 'details')),
  ADD CONSTRAINT appointments_household_visibility_consistent
    CHECK (
      (household_visibility = 'private' AND household_id IS NULL)
      OR (household_visibility IN ('busy', 'details') AND household_id IS NOT NULL)
    );

CREATE TABLE public.household_events (
  appointment_id uuid PRIMARY KEY REFERENCES public.appointments(id) ON DELETE CASCADE,
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_display_name text NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('busy', 'details')),
  title text NOT NULL,
  notes text,
  location text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  timezone text NOT NULL DEFAULT 'UTC',
  is_all_day boolean NOT NULL DEFAULT false,
  commitment_type text NOT NULL CHECK (commitment_type IN ('fixed', 'flexible')),
  recurrence_rule text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX household_members_household_idx ON public.household_members (household_id);
CREATE INDEX household_invites_household_idx ON public.household_invites (household_id, expires_at);
CREATE INDEX household_events_household_start_idx ON public.household_events (household_id, starts_at);
CREATE INDEX appointments_household_idx ON public.appointments (household_id, starts_at)
  WHERE household_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.is_household_member(target_household_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.household_members hm
      WHERE hm.household_id = target_household_id
        AND hm.user_id = (SELECT auth.uid())
    );
$$;

CREATE OR REPLACE FUNCTION private.is_household_owner(target_household_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.households h
      WHERE h.id = target_household_id
        AND h.owner_user_id = (SELECT auth.uid())
    );
$$;

REVOKE ALL ON FUNCTION private.is_household_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_household_owner(uuid) FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_household_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_household_owner(uuid) TO authenticated;

ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their household"
  ON public.households FOR SELECT TO authenticated
  USING (private.is_household_member(id));
CREATE POLICY "Owners can update their household"
  ON public.households FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = owner_user_id)
  WITH CHECK ((SELECT auth.uid()) = owner_user_id);
CREATE POLICY "Owners can delete their household"
  ON public.households FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = owner_user_id);

CREATE POLICY "Members can view household members"
  ON public.household_members FOR SELECT TO authenticated
  USING (private.is_household_member(household_id));
CREATE POLICY "Members can leave their household"
  ON public.household_members FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id AND role = 'member');

CREATE POLICY "Owners can view household invites"
  ON public.household_invites FOR SELECT TO authenticated
  USING (private.is_household_owner(household_id));
CREATE POLICY "Owners can revoke household invites"
  ON public.household_invites FOR DELETE TO authenticated
  USING (private.is_household_owner(household_id));

CREATE POLICY "Members can view redacted household events"
  ON public.household_events FOR SELECT TO authenticated
  USING (private.is_household_member(household_id));

DROP POLICY IF EXISTS "Users manage own appointments" ON public.appointments;
CREATE POLICY "Users can view own appointments"
  ON public.appointments FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can create own appointments"
  ON public.appointments FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (household_id IS NULL OR private.is_household_member(household_id))
  );
CREATE POLICY "Users can update own appointments"
  ON public.appointments FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (household_id IS NULL OR private.is_household_member(household_id))
  );
CREATE POLICY "Users can delete own appointments"
  ON public.appointments FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE OR REPLACE FUNCTION public.create_household(p_name text, p_display_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id uuid := auth.uid();
  household_id uuid;
BEGIN
  IF caller_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF char_length(trim(p_name)) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'Household name must be 1 to 80 characters'; END IF;
  IF char_length(trim(p_display_name)) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'Display name must be 1 to 80 characters'; END IF;
  IF EXISTS (SELECT 1 FROM public.household_members WHERE user_id = caller_id) THEN
    RAISE EXCEPTION 'You already belong to a household';
  END IF;
  INSERT INTO public.households (owner_user_id, name)
  VALUES (caller_id, trim(p_name)) RETURNING id INTO household_id;
  INSERT INTO public.household_members (household_id, user_id, display_name, role)
  VALUES (household_id, caller_id, trim(p_display_name), 'owner');
  RETURN household_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_household_invite(p_household_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id uuid := auth.uid();
  invite_id uuid;
BEGIN
  IF caller_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.households
    WHERE id = p_household_id AND owner_user_id = caller_id
  ) THEN RAISE EXCEPTION 'Only the household owner can create invitations'; END IF;
  DELETE FROM public.household_invites
  WHERE household_id = p_household_id AND expires_at <= now();
  INSERT INTO public.household_invites (household_id, created_by)
  VALUES (p_household_id, caller_id) RETURNING id INTO invite_id;
  RETURN invite_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_household(p_invite_id uuid, p_display_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id uuid := auth.uid();
  target_household_id uuid;
BEGIN
  IF caller_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF char_length(trim(p_display_name)) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'Display name must be 1 to 80 characters'; END IF;
  IF EXISTS (SELECT 1 FROM public.household_members WHERE user_id = caller_id) THEN
    RAISE EXCEPTION 'You already belong to a household';
  END IF;
  SELECT household_id INTO target_household_id
  FROM public.household_invites
  WHERE id = p_invite_id AND expires_at > now() AND used_count < max_uses
  FOR UPDATE;
  IF target_household_id IS NULL THEN RAISE EXCEPTION 'That invitation is invalid or expired'; END IF;
  INSERT INTO public.household_members (household_id, user_id, display_name, role)
  VALUES (target_household_id, caller_id, trim(p_display_name), 'member');
  UPDATE public.household_invites SET used_count = used_count + 1 WHERE id = p_invite_id;
  RETURN target_household_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_household(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_household_invite(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.join_household(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_household(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_household_invite(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_household(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION private.sync_household_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  owner_name text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.household_events WHERE appointment_id = OLD.id;
    RETURN OLD;
  END IF;
  IF NEW.household_id IS NULL OR NEW.household_visibility = 'private' THEN
    DELETE FROM public.household_events WHERE appointment_id = NEW.id;
    RETURN NEW;
  END IF;
  SELECT display_name INTO owner_name
  FROM public.household_members
  WHERE household_id = NEW.household_id AND user_id = NEW.user_id;
  IF owner_name IS NULL THEN RAISE EXCEPTION 'Appointment owner is not a household member'; END IF;
  INSERT INTO public.household_events (
    appointment_id, household_id, owner_user_id, owner_display_name, visibility,
    title, notes, location, starts_at, ends_at, timezone, is_all_day,
    commitment_type, recurrence_rule, updated_at
  ) VALUES (
    NEW.id, NEW.household_id, NEW.user_id, owner_name, NEW.household_visibility,
    CASE WHEN NEW.household_visibility = 'busy' THEN 'Busy' ELSE NEW.title END,
    CASE WHEN NEW.household_visibility = 'busy' THEN NULL ELSE NEW.notes END,
    CASE WHEN NEW.household_visibility = 'busy' THEN NULL ELSE NEW.location END,
    NEW.starts_at, NEW.ends_at, COALESCE(NEW.timezone, 'UTC'), NEW.is_all_day,
    NEW.commitment_type, NEW.recurrence_rule, now()
  )
  ON CONFLICT (appointment_id) DO UPDATE SET
    household_id = EXCLUDED.household_id,
    owner_user_id = EXCLUDED.owner_user_id,
    owner_display_name = EXCLUDED.owner_display_name,
    visibility = EXCLUDED.visibility,
    title = EXCLUDED.title,
    notes = EXCLUDED.notes,
    location = EXCLUDED.location,
    starts_at = EXCLUDED.starts_at,
    ends_at = EXCLUDED.ends_at,
    timezone = EXCLUDED.timezone,
    is_all_day = EXCLUDED.is_all_day,
    commitment_type = EXCLUDED.commitment_type,
    recurrence_rule = EXCLUDED.recurrence_rule,
    updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_household_event() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER appointments_sync_household_event
  AFTER INSERT OR UPDATE OR DELETE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION private.sync_household_event();

REVOKE ALL ON public.households, public.household_members, public.household_invites, public.household_events FROM anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.households TO authenticated;
GRANT SELECT, DELETE ON public.household_members TO authenticated;
GRANT SELECT, DELETE ON public.household_invites TO authenticated;
GRANT SELECT ON public.household_events TO authenticated;
REVOKE ALL ON public.appointments FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointments TO authenticated;

CREATE TRIGGER households_set_updated_at
  BEFORE UPDATE ON public.households
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP VIEW IF EXISTS public.schedule_hub_events;
CREATE VIEW public.schedule_hub_events
WITH (security_invoker = true) AS
SELECT
  a.id, a.user_id, a.title, a.notes, a.location, a.starts_at, a.ends_at,
  COALESCE(a.timezone, 'UTC') AS timezone, a.is_all_day, a.commitment_type,
  a.privacy_level, a.sync_status,
  COALESCE(a.provider, CASE WHEN a.calendar_event_id IS NOT NULL THEN 'google_calendar'
    WHEN a.gmail_message_id IS NOT NULL OR a.source = 'gmail' THEN 'google_mail' ELSE 'chronos' END) AS provider,
  a.provider_account_id, a.calendar_id, a.calendar_event_id, a.recurrence_rule, a.source,
  CASE WHEN a.source = 'routine' THEN 'Routine'
    WHEN a.calendar_event_id IS NOT NULL THEN 'Google Calendar'
    WHEN a.gmail_message_id IS NOT NULL OR a.source = 'gmail' THEN 'Gmail'
    WHEN a.source = 'task' THEN 'Task block'
    WHEN a.source = 'quick_add' THEN 'Quick add'
    WHEN a.source = 'ai' THEN 'AI planner' ELSE 'Manual' END AS source_label,
  CASE WHEN a.ends_at IS NOT NULL THEN GREATEST(0, (EXTRACT(EPOCH FROM (a.ends_at - a.starts_at)) / 60)::int) ELSE 30 END AS duration_min,
  a.created_at, a.updated_at, false AS is_household_shared, NULL::text AS shared_by_name,
  a.household_id, a.household_visibility
FROM public.appointments a
UNION ALL
SELECT
  h.appointment_id, h.owner_user_id, h.title, h.notes, h.location, h.starts_at, h.ends_at,
  h.timezone, h.is_all_day, h.commitment_type, 'shared'::text, 'local'::text,
  'chronos'::text, NULL::text, NULL::text, NULL::text, h.recurrence_rule, 'household'::text,
  ('Family · ' || h.owner_display_name),
  CASE WHEN h.ends_at IS NOT NULL THEN GREATEST(0, (EXTRACT(EPOCH FROM (h.ends_at - h.starts_at)) / 60)::int) ELSE 30 END,
  h.updated_at, h.updated_at, true, h.owner_display_name, h.household_id, h.visibility
FROM public.household_events h
WHERE h.owner_user_id <> (SELECT auth.uid());

REVOKE ALL ON public.schedule_hub_events FROM anon;
GRANT SELECT ON public.schedule_hub_events TO authenticated, service_role;

COMMENT ON TABLE public.household_events IS
  'Share-safe appointment projection. Busy-only rows never contain private titles, notes, or locations.';
COMMENT ON COLUMN public.appointments.household_visibility IS
  'Private by default. Busy shares only the time; details shares the selected appointment fields.';
