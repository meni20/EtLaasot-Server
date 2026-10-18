-- pwa_installations is intentionally inaccessible to browser database roles.
-- NestJS connects with this dedicated server role and resolves the user from
-- the authenticated JWT before creating or refreshing an installation row.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE pwa_installations
  TO etlaasot_app;

CREATE POLICY pwa_installations_server_access
  ON pwa_installations
  FOR ALL
  TO etlaasot_app
  USING (true)
  WITH CHECK (true);
