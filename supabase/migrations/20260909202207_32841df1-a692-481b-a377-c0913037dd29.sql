-- Satisfy the RLS linter for the existing service-role-only app_user_connections table.
-- Authenticated users have no grants on this table; this policy makes that explicit.

DROP POLICY IF EXISTS "Deny all authenticated access" ON public.app_user_connections;
CREATE POLICY "Deny all authenticated access"
  ON public.app_user_connections
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);
