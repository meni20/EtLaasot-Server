-- Additive onboarding state only. Apply with the existing owner workflow.
CREATE TABLE public.onboarding_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL UNIQUE REFERENCES public.trainee_applications(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE RESTRICT,
  recipient varchar(320),
  status varchar(16) NOT NULL CHECK (status IN ('PENDING','PROCESSING','SENT','FAILED','SKIPPED','CANCELLED','EXPIRED')),
  reason varchar(40),
  token_hash varchar(64) UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  token_ciphertext text,
  credential_hash varchar(64) CHECK (credential_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz,
  consumed_at timestamptz,
  revoked_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claim_id uuid,
  lease_until timestamptz,
  message_id varchar(150),
  sent_at timestamptz,
  retry_requested_by uuid REFERENCES public."user"(id) ON DELETE RESTRICT,
  retry_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status='SKIPPED' AND token_hash IS NULL AND token_ciphertext IS NULL) OR
         (status<>'SKIPPED' AND token_hash IS NOT NULL AND credential_hash IS NOT NULL AND expires_at IS NOT NULL)),
  CHECK (status<>'PROCESSING' OR (claim_id IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX onboarding_delivery_due ON public.onboarding_deliveries(next_attempt_at)
  WHERE status IN ('PENDING','PROCESSING');
CREATE INDEX onboarding_delivery_user ON public.onboarding_deliveries(user_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;
ALTER TABLE public.onboarding_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.onboarding_deliveries FROM PUBLIC;
DO $acl$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','etlaasot_app'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON public.onboarding_deliveries FROM %I',r);
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='etlaasot_app') THEN
    GRANT SELECT,INSERT,UPDATE ON public.onboarding_deliveries TO etlaasot_app;
    CREATE POLICY onboarding_server_access ON public.onboarding_deliveries
      FOR ALL TO etlaasot_app USING(true) WITH CHECK(true);
  END IF;
END $acl$;

-- Runs under the caller's existing app role; no SECURITY DEFINER elevation.
-- User row locks precede onboarding row locks throughout the implementation.
CREATE FUNCTION public.revoke_onboarding_on_credential_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash
     OR NEW.password_changed_at IS DISTINCT FROM OLD.password_changed_at
     OR NEW.must_change_password IS DISTINCT FROM OLD.must_change_password
     OR NEW.temporary_password_expires_at IS DISTINCT FROM OLD.temporary_password_expires_at
     OR NEW.national_id_hash IS DISTINCT FROM OLD.national_id_hash
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW."deletedAt" IS DISTINCT FROM OLD."deletedAt"
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW."branchId" IS DISTINCT FROM OLD."branchId" THEN
    UPDATE public.onboarding_deliveries
    SET revoked_at=now(),status='CANCELLED',reason='CREDENTIAL_CHANGED',
        token_ciphertext=NULL,claim_id=NULL,lease_until=NULL
    WHERE user_id=NEW.id AND token_hash IS NOT NULL
      AND consumed_at IS NULL AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.revoke_onboarding_on_credential_change() FROM PUBLIC;
CREATE TRIGGER user_revoke_onboarding_links AFTER UPDATE OF
  password_hash,password_changed_at,must_change_password,temporary_password_expires_at,
  national_id_hash,is_active,"deletedAt",email,"branchId" ON public."user"
  FOR EACH ROW EXECUTE FUNCTION public.revoke_onboarding_on_credential_change();

CREATE FUNCTION public.revoke_onboarding_on_role_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  UPDATE public.onboarding_deliveries SET revoked_at=now(),status='CANCELLED',
    reason='ROLE_CHANGED',token_ciphertext=NULL,claim_id=NULL,lease_until=NULL
  WHERE user_id=CASE WHEN TG_OP='DELETE' THEN OLD."userId" ELSE NEW."userId" END
    AND token_hash IS NOT NULL AND consumed_at IS NULL AND revoked_at IS NULL;
  RETURN NULL;
END $$;
CREATE TRIGGER user_role_revoke_onboarding_links AFTER INSERT OR UPDATE OR DELETE
  ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.revoke_onboarding_on_role_change();
REVOKE ALL ON FUNCTION public.revoke_onboarding_on_role_change() FROM PUBLIC;
DO $function_acl$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','etlaasot_app'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.revoke_onboarding_on_credential_change() FROM %I',r);
      EXECUTE format('REVOKE ALL ON FUNCTION public.revoke_onboarding_on_role_change() FROM %I',r);
    END IF;
  END LOOP;
END $function_acl$;
