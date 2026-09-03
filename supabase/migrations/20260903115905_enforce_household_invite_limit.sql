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
    AND i.expires_at > now()
    AND (
      SELECT count(*)
      FROM public.household_members hm
      WHERE hm.invite_id = i.id
    ) < i.max_uses;
$$;

REVOKE ALL ON FUNCTION private.household_for_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.household_for_invite(uuid) TO authenticated;
