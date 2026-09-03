ALTER TABLE public.household_members
  ADD COLUMN invite_id uuid REFERENCES public.household_invites(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION private.household_for_invite(target_invite_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT i.household_id
  FROM public.household_invites i
  WHERE (SELECT auth.uid()) IS NOT NULL
    AND i.id = target_invite_id
    AND i.expires_at > now();
$$;

REVOKE ALL ON FUNCTION private.household_for_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.household_for_invite(uuid) TO authenticated;

DROP POLICY "Members can view their household" ON public.households;
CREATE POLICY "Members can view their household"
  ON public.households FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = owner_user_id OR private.is_household_member(id));

CREATE POLICY "Users can create their own household"
  ON public.households FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = owner_user_id);

CREATE POLICY "Users can join a household as themselves"
  ON public.household_members FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (
      (
        role = 'owner' AND invite_id IS NULL
        AND EXISTS (
          SELECT 1 FROM public.households h
          WHERE h.id = household_id AND h.owner_user_id = (SELECT auth.uid())
        )
      )
      OR (
        role = 'member' AND invite_id IS NOT NULL
        AND private.household_for_invite(invite_id) = household_id
      )
    )
  );

CREATE POLICY "Owners can create household invites"
  ON public.household_invites FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = created_by
    AND private.is_household_owner(household_id)
  );

CREATE OR REPLACE FUNCTION public.create_household(p_name text, p_display_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
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
SECURITY INVOKER
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
SECURITY INVOKER
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
  SELECT private.household_for_invite(p_invite_id) INTO target_household_id;
  IF target_household_id IS NULL THEN RAISE EXCEPTION 'That invitation is invalid or expired'; END IF;
  INSERT INTO public.household_members (household_id, user_id, display_name, role, invite_id)
  VALUES (target_household_id, caller_id, trim(p_display_name), 'member', p_invite_id);
  RETURN target_household_id;
END;
$$;

GRANT INSERT ON public.households, public.household_members, public.household_invites TO authenticated;
