CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_uuid uuid NOT NULL REFERENCES "user"(id) ON UPDATE CASCADE ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  expiration_time timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint),
  CONSTRAINT push_subscriptions_endpoint_not_blank CHECK (btrim(endpoint) <> ''),
  CONSTRAINT push_subscriptions_p256dh_not_blank CHECK (btrim(p256dh) <> ''),
  CONSTRAINT push_subscriptions_auth_not_blank CHECK (btrim(auth) <> ''),
  CONSTRAINT push_subscriptions_seen_check CHECK (last_seen_at >= created_at),
  CONSTRAINT push_subscriptions_updated_check CHECK (updated_at >= created_at)
);

CREATE INDEX push_subscriptions_user_uuid_idx
  ON push_subscriptions (user_uuid);

-- Access is exclusively through NestJS using its own JWT authentication.
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE push_subscriptions FROM PUBLIC, anon, authenticated;
