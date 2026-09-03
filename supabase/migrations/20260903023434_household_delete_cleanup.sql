CREATE OR REPLACE FUNCTION private.prepare_household_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.appointments
  SET household_id = NULL, household_visibility = 'private'
  WHERE household_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION private.prepare_household_member_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.appointments
  SET household_id = NULL, household_visibility = 'private'
  WHERE household_id = OLD.household_id AND user_id = OLD.user_id;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION private.prepare_household_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.prepare_household_member_delete() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER household_prepare_delete
  BEFORE DELETE ON public.households
  FOR EACH ROW EXECUTE FUNCTION private.prepare_household_delete();

CREATE TRIGGER household_member_prepare_delete
  BEFORE DELETE ON public.household_members
  FOR EACH ROW EXECUTE FUNCTION private.prepare_household_member_delete();
