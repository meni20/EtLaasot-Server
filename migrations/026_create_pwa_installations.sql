CREATE TABLE pwa_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL,
  user_uuid uuid NOT NULL REFERENCES "user"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  platform varchar(32) NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pwa_installations_installation_id_key UNIQUE (installation_id),
  CONSTRAINT pwa_installations_platform_check
    CHECK (platform IN ('android', 'ios', 'chromium', 'other')),
  CONSTRAINT pwa_installations_seen_check CHECK (last_seen_at >= installed_at)
);

CREATE INDEX pwa_installations_user_uuid_idx
  ON pwa_installations (user_uuid);

-- Access is through NestJS using its own JWT authentication.
ALTER TABLE pwa_installations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pwa_installations FROM PUBLIC, anon, authenticated;
