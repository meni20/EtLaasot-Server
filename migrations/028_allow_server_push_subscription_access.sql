-- push_subscriptions is intentionally inaccessible to browser database roles.
-- NestJS connects with this dedicated server role and performs authorization
-- from the authenticated JWT before accessing subscription rows.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE push_subscriptions
  TO etlaasot_app;

CREATE POLICY push_subscriptions_server_access
  ON push_subscriptions
  FOR ALL
  TO etlaasot_app
  USING (true)
  WITH CHECK (true);
