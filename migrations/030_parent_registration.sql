-- Forward only. Requires user UUID identity migrations through 029.
-- Run by the table owner after review. No storage bucket or object is created.
CREATE TABLE activity_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL UNIQUE CHECK (length(btrim(name)) > 0),
  starts_on date NOT NULL,
  ends_on date NOT NULL CHECK (ends_on >= starts_on),
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (starts_on, ends_on)
);
CREATE UNIQUE INDEX activity_years_one_active ON activity_years (is_active) WHERE is_active;

CREATE TABLE branch_registration_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_year_id uuid NOT NULL REFERENCES activity_years(id) ON DELETE RESTRICT,
  branch_id varchar(50) NOT NULL REFERENCES branch(id) ON DELETE RESTRICT,
  status varchar(10) NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
  opened_by uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, activity_year_id),
  CHECK ((status = 'OPEN' AND closed_at IS NULL) OR (status = 'CLOSED' AND closed_at IS NOT NULL))
);

CREATE TABLE registration_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainee_uuid uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  branch_id varchar(50) NOT NULL REFERENCES branch(id) ON DELETE RESTRICT,
  activity_year_id uuid NOT NULL REFERENCES activity_years(id) ON DELETE RESTRICT,
  request_type varchar(12) NOT NULL CHECK (request_type IN ('YEARLY', 'INDIVIDUAL')),
  status varchar(24) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED')),
  draft_data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(draft_data) = 'object' AND octet_length(draft_data::text) <= 131072),
  draft_revision integer NOT NULL DEFAULT 0 CHECK (draft_revision >= 0),
  current_step smallint NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 5),
  blocks_access boolean NOT NULL DEFAULT true,
  request_reason varchar(2000),
  feedback_reason varchar(2000),
  previous_approved_form_id uuid REFERENCES registration_forms(id) ON DELETE RESTRICT,
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid REFERENCES "user"(id) ON DELETE RESTRICT,
  document_status varchar(12) NOT NULL DEFAULT 'PENDING' CHECK (document_status IN ('PENDING', 'READY', 'FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (request_type <> 'INDIVIDUAL' OR (request_reason IS NOT NULL AND length(btrim(request_reason)) > 0)),
  CHECK (status <> 'APPROVED' OR (approved_at IS NOT NULL AND approved_by IS NOT NULL AND document_status = 'READY'))
);
CREATE UNIQUE INDEX registration_one_active_trainee ON registration_forms (trainee_uuid)
  WHERE status IN ('DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED');
CREATE UNIQUE INDEX registration_one_yearly ON registration_forms (trainee_uuid, branch_id, activity_year_id)
  WHERE request_type = 'YEARLY';
CREATE INDEX registration_admin_queue ON registration_forms (branch_id, status, activity_year_id, created_at DESC);
CREATE INDEX registration_forms_year ON registration_forms (activity_year_id);
CREATE INDEX registration_forms_previous ON registration_forms (previous_approved_form_id);
CREATE INDEX registration_periods_year ON branch_registration_periods (activity_year_id);

CREATE TABLE registration_form_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL REFERENCES registration_forms(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number > 0),
  form_data jsonb NOT NULL CHECK (jsonb_typeof(form_data) = 'object' AND octet_length(form_data::text) <= 131072),
  template_version varchar(50) NOT NULL,
  declaration_version varchar(80) NOT NULL,
  declarations jsonb NOT NULL CHECK (jsonb_typeof(declarations) = 'array' AND jsonb_array_length(declarations) = 10),
  signing_metadata jsonb NOT NULL CHECK (jsonb_typeof(signing_metadata) = 'object'),
  idempotency_key uuid NOT NULL,
  submitted_revision integer NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (form_id, version_number),
  UNIQUE (form_id, idempotency_key),
  UNIQUE (form_id, id)
);

CREATE TABLE registration_form_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL REFERENCES registration_forms(id) ON DELETE RESTRICT,
  version_id uuid,
  kind varchar(24) NOT NULL CHECK (kind IN ('REGISTRATION_PDF', 'PHYSICIAN_SUMMARY', 'SIGNATURE')),
  storage_bucket varchar(100) NOT NULL CHECK (length(btrim(storage_bucket)) > 0),
  storage_path varchar(300) NOT NULL UNIQUE CHECK (length(btrim(storage_path)) > 0),
  mime_type varchar(64) NOT NULL,
  file_size integer NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
  checksum varchar(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (form_id, version_id) REFERENCES registration_form_versions(form_id, id) ON DELETE RESTRICT,
  CHECK ((kind = 'SIGNATURE' AND mime_type = 'image/png') OR (kind IN ('REGISTRATION_PDF','PHYSICIAN_SUMMARY') AND mime_type = 'application/pdf')),
  CHECK (kind <> 'REGISTRATION_PDF' OR version_id IS NOT NULL)
);
CREATE INDEX registration_documents_form ON registration_form_documents (form_id, version_id);
CREATE UNIQUE INDEX registration_pdf_per_version ON registration_form_documents (version_id) WHERE kind = 'REGISTRATION_PDF';

CREATE TABLE registration_form_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid REFERENCES registration_forms(id) ON DELETE RESTRICT,
  version_id uuid,
  period_id uuid REFERENCES branch_registration_periods(id) ON DELETE RESTRICT,
  actor_uuid uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  action varchar(40) NOT NULL CHECK (action IN ('DRAFT_CREATED','SUBMITTED','PDF_GENERATED','PDF_FAILED','CHANGES_REQUESTED','RESUBMITTED','APPROVED','INDIVIDUAL_RENEWAL_REQUESTED','ANNUAL_REGISTRATION_OPENED')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object' AND metadata - ARRAY['revision','versionNumber','documentStatus','requestType']::text[] = '{}'::jsonb),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (form_id, version_id) REFERENCES registration_form_versions(form_id, id) ON DELETE RESTRICT,
  CHECK (form_id IS NOT NULL OR period_id IS NOT NULL),
  CHECK (version_id IS NULL OR form_id IS NOT NULL)
);
CREATE INDEX registration_history_form ON registration_form_history (form_id, created_at);
CREATE INDEX registration_history_period ON registration_form_history (period_id);
CREATE INDEX registration_history_actor ON registration_form_history (actor_uuid);

-- Registration uses Nest JWTs, NOT Supabase Auth. No direct Data API grants.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['activity_years','branch_registration_periods','registration_forms','registration_form_versions','registration_form_documents','registration_form_history'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', table_name);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', table_name);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM service_role', table_name);
    END IF;
    -- DEV's runtime role is neither the table owner nor a BYPASSRLS role.
    -- The synthetic owner-based tests do not exercise this Supabase distinction.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'etlaasot_app') THEN
      -- Remove inherited default ACLs before granting the minimum operations.
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM etlaasot_app', table_name);
      IF table_name IN ('activity_years', 'branch_registration_periods', 'registration_forms') THEN
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO etlaasot_app', table_name);
      ELSE
        EXECUTE format('GRANT SELECT, INSERT ON TABLE public.%I TO etlaasot_app', table_name);
      END IF;
      -- Nest enforces the JWT actor and branch scope; browser roles have no access.
      EXECUTE format('CREATE POLICY registration_server_access ON public.%I FOR ALL TO etlaasot_app USING (true) WITH CHECK (true)', table_name);
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION public.reject_registration_record_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Registration evidence is immutable' USING ERRCODE = '23514';
END $$;
REVOKE ALL ON FUNCTION public.reject_registration_record_mutation() FROM PUBLIC;
-- Supabase's existing default ACL explicitly grants these roles function EXECUTE;
-- revoking PUBLIC alone does not remove those individual grants.
DO $$
DECLARE client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.reject_registration_record_mutation() FROM %I', client_role);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'etlaasot_app') THEN
    GRANT EXECUTE ON FUNCTION public.reject_registration_record_mutation() TO etlaasot_app;
  END IF;
END $$;
CREATE TRIGGER registration_versions_immutable BEFORE UPDATE OR DELETE ON registration_form_versions
  FOR EACH ROW EXECUTE FUNCTION public.reject_registration_record_mutation();
CREATE TRIGGER registration_history_immutable BEFORE UPDATE OR DELETE ON registration_form_history
  FOR EACH ROW EXECUTE FUNCTION public.reject_registration_record_mutation();
CREATE TRIGGER registration_documents_immutable BEFORE UPDATE OR DELETE ON registration_form_documents
  FOR EACH ROW EXECUTE FUNCTION public.reject_registration_record_mutation();
