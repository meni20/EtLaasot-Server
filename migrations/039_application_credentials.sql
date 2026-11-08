-- PREPARED ONLY: DEV owner workflow, after 038. Do not execute without approval.
-- No existing rows, passwords, recovery codes, documents or history are rewritten.
CREATE TABLE public.application_credentials (
  application_id uuid PRIMARY KEY REFERENCES public.trainee_applications(id) ON DELETE RESTRICT,
  national_id_hash varchar(64) NOT NULL UNIQUE CHECK (national_id_hash ~ '^[0-9a-f]{64}$'),
  password_hash text NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
  login_email varchar(254) NOT NULL CHECK (login_email = lower(btrim(login_email)) AND length(login_email) > 3),
  email_verified boolean NOT NULL DEFAULT false CHECK (email_verified = false),
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Email is deliberately NOT unique: family members may share a mailbox.
ALTER TABLE public.trainee_applications ADD CONSTRAINT application_identity_pair UNIQUE(id,national_id_hash);
ALTER TABLE public.application_credentials ADD CONSTRAINT credentials_application_identity
  FOREIGN KEY(application_id,national_id_hash) REFERENCES public.trainee_applications(id,national_id_hash) ON DELETE RESTRICT;
ALTER TABLE public.application_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.application_credentials FROM PUBLIC,anon,authenticated,service_role,etlaasot_app;
GRANT SELECT,INSERT,UPDATE ON public.application_credentials TO etlaasot_app;
CREATE POLICY application_credentials_server ON public.application_credentials
  FOR ALL TO etlaasot_app USING(true) WITH CHECK(true);

-- A new password signup precedes branch selection. All submitted states require it.
ALTER TABLE public.trainee_applications ALTER COLUMN branch_id DROP NOT NULL;
ALTER TABLE public.trainee_applications ADD CONSTRAINT application_branch_required
  CHECK (status='DRAFT' OR branch_id IS NOT NULL);
-- Password sessions reuse the applicant boundary, without generating recovery codes.
ALTER TABLE public.applicant_sessions ALTER COLUMN recovery_hash DROP NOT NULL;
ALTER TABLE public.applicant_sessions ALTER COLUMN recovery_expires_at DROP NOT NULL;
ALTER TABLE public.applicant_sessions ADD CONSTRAINT applicant_recovery_pair
  CHECK ((recovery_hash IS NULL) = (recovery_expires_at IS NULL));

-- Every credential writer and user identity writer takes the same xact lock.
-- This also covers manual user creation, which does not use the signup service.
CREATE FUNCTION registration_private.guard_application_credentials() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.application_id IS DISTINCT FROM OLD.application_id OR NEW.national_id_hash IS DISTINCT FROM OLD.national_id_hash) THEN
    RAISE EXCEPTION 'Credential association is immutable' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('application-identity:'||NEW.national_id_hash,0));
  IF EXISTS(SELECT 1 FROM public."user" WHERE national_id_hash=NEW.national_id_hash)
     OR NOT EXISTS(SELECT 1 FROM public.trainee_applications WHERE id=NEW.application_id
       AND national_id_hash=NEW.national_id_hash AND provisioned_user_id IS NULL
       AND status<>'APPROVED' AND deletion_requested_at IS NULL) THEN
    RAISE EXCEPTION 'Credential identity unavailable' USING ERRCODE='23505';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_application_credentials BEFORE INSERT OR UPDATE ON public.application_credentials
  FOR EACH ROW EXECUTE FUNCTION registration_private.guard_application_credentials();

CREATE FUNCTION registration_private.guard_user_applicant_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE credential public.application_credentials%ROWTYPE;
BEGIN
  IF NEW.national_id_hash IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.national_id_hash IS NOT DISTINCT FROM OLD.national_id_hash THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('application-identity:'||NEW.national_id_hash,0));
  SELECT * INTO credential FROM public.application_credentials WHERE national_id_hash=NEW.national_id_hash;
  IF FOUND AND NOT (
    NEW.password_hash IS NOT DISTINCT FROM credential.password_hash
    AND NEW.must_change_password=false AND NEW.temporary_password_expires_at IS NULL
    AND EXISTS(SELECT 1 FROM public.trainee_applications WHERE id=credential.application_id
      AND status='PENDING_REVIEW' AND provisioned_user_id IS NULL AND deletion_requested_at IS NULL)
  ) THEN
    RAISE EXCEPTION 'Applicant identity requires approved credential transfer' USING ERRCODE='23505';
  END IF;
  RETURN NEW;
END $$;
-- Existing account password changes do not invoke this trigger.
CREATE TRIGGER guard_user_applicant_identity BEFORE INSERT OR UPDATE OF national_id_hash ON public."user"
  FOR EACH ROW EXECUTE FUNCTION registration_private.guard_user_applicant_identity();
REVOKE ALL ON FUNCTION registration_private.guard_application_credentials(),
  registration_private.guard_user_applicant_identity() FROM PUBLIC,anon,authenticated,service_role,etlaasot_app;

-- Credential-bearing drafts intentionally cannot be purged by the old deletion
-- function: ON DELETE RESTRICT fails closed. A future approved cleanup must handle
-- credentials explicitly. No deletion behavior or stored evidence is changed here.
