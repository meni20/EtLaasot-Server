-- Forward-only, LOCAL PREPARATION ONLY. Requires 030; apply only with separate approval.
-- No existing account, medical row, Storage bucket, key or policy is modified.
CREATE TABLE public.trainee_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  national_id_hash varchar(64) NOT NULL UNIQUE CHECK (national_id_hash ~ '^[0-9a-f]{64}$'),
  national_id_encrypted text NOT NULL,
  branch_id varchar(50) NOT NULL REFERENCES public.branch(id) ON DELETE RESTRICT,
  status varchar(24) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING_REVIEW','CHANGES_REQUESTED','REJECTED','APPROVED')),
  draft_data jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(draft_data) = 'object' AND octet_length(draft_data::text) <= 131072),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  current_step smallint NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 5),
  feedback_reason varchar(2000),
  document_status varchar(12) NOT NULL DEFAULT 'PENDING' CHECK (document_status IN ('PENDING','READY','FAILED')),
  provisioned_user_id uuid UNIQUE REFERENCES public."user"(id) ON DELETE RESTRICT,
  approved_activity_year_id uuid REFERENCES public.activity_years(id) ON DELETE RESTRICT,
  reviewed_by uuid REFERENCES public."user"(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'APPROVED' OR (provisioned_user_id IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND document_status = 'READY')),
  CHECK (status NOT IN ('REJECTED','CHANGES_REQUESTED') OR (feedback_reason IS NOT NULL AND length(btrim(feedback_reason)) > 0))
);
CREATE INDEX trainee_applications_queue ON public.trainee_applications(branch_id,status,created_at DESC,id);
CREATE INDEX trainee_applications_reviewer ON public.trainee_applications(reviewed_by);
CREATE INDEX trainee_applications_approved_year ON public.trainee_applications(approved_activity_year_id);
CREATE TABLE public.applicant_sessions (
  application_id uuid PRIMARY KEY REFERENCES public.trainee_applications(id) ON DELETE RESTRICT,
  token_hash varchar(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  recovery_hash varchar(64) NOT NULL UNIQUE CHECK (recovery_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  recovery_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (recovery_expires_at >= expires_at)
);
CREATE TABLE public.trainee_application_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.trainee_applications(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number > 0),
  submitted_revision integer NOT NULL CHECK (submitted_revision >= 0),
  idempotency_key uuid NOT NULL,
  form_data jsonb NOT NULL CHECK (jsonb_typeof(form_data) = 'object' AND octet_length(form_data::text) <= 131072),
  content_hash varchar(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  declarations jsonb NOT NULL CHECK (jsonb_typeof(declarations) = 'array' AND jsonb_array_length(declarations) = 10),
  declaration_version varchar(80) NOT NULL,
  template_version varchar(50) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(application_id,version_number), UNIQUE(application_id,idempotency_key), UNIQUE(application_id,id)
);
CREATE TABLE public.trainee_application_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.trainee_applications(id) ON DELETE RESTRICT,
  version_id uuid,
  kind varchar(24) NOT NULL CHECK (kind IN ('PHYSICIAN_SUMMARY','SIGNATURE','REGISTRATION_PDF')),
  storage_bucket varchar(100) NOT NULL CHECK (length(btrim(storage_bucket)) > 0),
  storage_path varchar(300) NOT NULL UNIQUE CHECK (length(btrim(storage_path)) > 0),
  mime_type varchar(64) NOT NULL,
  file_size integer NOT NULL CHECK (file_size BETWEEN 1 AND 10485760),
  checksum varchar(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  content_hash varchar(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(application_id,version_id) REFERENCES public.trainee_application_versions(application_id,id) ON DELETE RESTRICT,
  CHECK ((kind = 'SIGNATURE' AND mime_type = 'image/png') OR (kind IN ('PHYSICIAN_SUMMARY','REGISTRATION_PDF') AND mime_type = 'application/pdf')),
  CHECK (kind <> 'REGISTRATION_PDF' OR version_id IS NOT NULL)
);
CREATE INDEX trainee_application_evidence_application ON public.trainee_application_evidence(application_id,version_id);
CREATE UNIQUE INDEX trainee_application_pdf_version ON public.trainee_application_evidence(version_id) WHERE kind='REGISTRATION_PDF';
CREATE TABLE public.trainee_application_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.trainee_applications(id) ON DELETE RESTRICT,
  actor_uuid uuid REFERENCES public."user"(id) ON DELETE RESTRICT,
  action varchar(32) NOT NULL CHECK (action IN ('CREATED','SUBMITTED','CHANGES_REQUESTED','REJECTED','APPROVED','RECOVERED','SESSION_REVOKED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trainee_application_events_application ON public.trainee_application_events(application_id,created_at);
CREATE INDEX trainee_application_events_actor ON public.trainee_application_events(actor_uuid);
-- Shared, atomic rate limits across replicas; no plaintext IP, ID or token stored.
CREATE TABLE public.registration_public_limits (
  key_hash varchar(64) PRIMARY KEY CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  attempts integer NOT NULL CHECK (attempts > 0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX registration_public_limits_expiry ON public.registration_public_limits(expires_at);

DO $registration_acl$
DECLARE t text; r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['trainee_applications','applicant_sessions','trainee_application_versions','trainee_application_evidence','trainee_application_events','registration_public_limits'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',t);
    FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','etlaasot_app'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,r);
      END IF;
    END LOOP;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='etlaasot_app') THEN
      IF t IN ('trainee_applications','applicant_sessions','registration_public_limits') THEN
        EXECUTE format('GRANT SELECT,INSERT,UPDATE ON TABLE public.%I TO etlaasot_app',t);
      ELSE
        EXECUTE format('GRANT SELECT,INSERT ON TABLE public.%I TO etlaasot_app',t);
      END IF;
      EXECUTE format('CREATE POLICY registration_server_access ON public.%I FOR ALL TO etlaasot_app USING (true) WITH CHECK (true)',t);
    END IF;
  END LOOP;
END $registration_acl$;
CREATE TRIGGER application_versions_immutable BEFORE UPDATE OR DELETE ON public.trainee_application_versions FOR EACH ROW EXECUTE FUNCTION public.reject_registration_record_mutation();
CREATE TRIGGER application_evidence_immutable BEFORE UPDATE OR DELETE ON public.trainee_application_evidence FOR EACH ROW EXECUTE FUNCTION public.reject_registration_record_mutation();
CREATE TRIGGER application_events_immutable BEFORE UPDATE OR DELETE ON public.trainee_application_events FOR EACH ROW EXECUTE FUNCTION public.reject_registration_record_mutation();
