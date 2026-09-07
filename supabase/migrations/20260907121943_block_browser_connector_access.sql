-- Keep the encrypted connector-handle table explicitly closed to browser roles.
-- Table privileges are already revoked; this restrictive policy is a second
-- RLS guard and documents the intentional service-role-only trust boundary.
DROP POLICY IF EXISTS "Browser roles cannot access connector handles"
  ON public.app_user_connections;

CREATE POLICY "Browser roles cannot access connector handles"
  ON public.app_user_connections
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
