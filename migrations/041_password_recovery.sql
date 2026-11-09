-- Additive DEV password recovery. Requires 039/040; no existing rows are rewritten.
CREATE TABLE public.password_recovery_bindings (
  national_id_hash varchar(64) PRIMARY KEY CHECK (national_id_hash ~ '^[a-f0-9]{64}$'),
  application_id uuid REFERENCES public.trainee_applications(id) ON DELETE RESTRICT,
  user_id uuid REFERENCES public."user"(id) ON DELETE RESTRICT,
  recipient varchar(254) NOT NULL CHECK (recipient=lower(btrim(recipient))),
  revision uuid NOT NULL,
  authorized_by uuid NOT NULL REFERENCES public."user"(id) ON DELETE RESTRICT,
  authorized_at timestamptz NOT NULL DEFAULT now(),
  authorized_until timestamptz NOT NULL,
  bound_at timestamptz,
  CHECK ((application_id IS NULL) <> (user_id IS NULL))
);
CREATE TABLE public.password_reset_challenges (
  token_digest varchar(64) PRIMARY KEY CHECK (token_digest ~ '^[a-f0-9]{64}$'),
  national_id_hash varchar(64) NOT NULL REFERENCES public.password_recovery_bindings(national_id_hash) ON DELETE RESTRICT,
  application_id uuid REFERENCES public.trainee_applications(id) ON DELETE RESTRICT,
  user_id uuid REFERENCES public."user"(id) ON DELETE RESTRICT,
  recipient varchar(254) NOT NULL,
  binding_revision uuid NOT NULL,
  credential_digest varchar(64) NOT NULL CHECK (credential_digest ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  revoked_at timestamptz,
  CHECK ((application_id IS NULL) <> (user_id IS NULL)),
  CHECK (expires_at>created_at AND expires_at<=created_at+interval '30 minutes')
);
CREATE UNIQUE INDEX password_reset_one_active ON public.password_reset_challenges(national_id_hash)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX password_reset_expiration ON public.password_reset_challenges(expires_at);
CREATE TABLE public.password_reset_session_revisions (
  user_id uuid PRIMARY KEY REFERENCES public."user"(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision>0)
);
DO $acl$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['password_recovery_bindings','password_reset_challenges','password_reset_session_revisions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tbl);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role,etlaasot_app',tbl);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO etlaasot_app',tbl);
    EXECUTE format('CREATE POLICY recovery_server_only ON public.%I FOR ALL TO etlaasot_app USING(true) WITH CHECK(true)',tbl);
  END LOOP;
END $acl$;
-- No plaintext/encrypted link tokens, email verification at signup, Storage changes,
-- password rewrites, browser access or automatic legacy-email binding.
