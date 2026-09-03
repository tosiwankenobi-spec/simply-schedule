DROP POLICY "Members can leave their household" ON public.household_members;
CREATE POLICY "Members can leave or owners can disconnect members"
  ON public.household_members FOR DELETE TO authenticated
  USING (
    role = 'member'
    AND (
      (SELECT auth.uid()) = user_id
      OR private.is_household_owner(household_id)
    )
  );
