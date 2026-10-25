-- Phase 1 preparation only. Requires 030, 031 and 032. Never run remotely as part
-- of local development. No application payloads, signatures or evidence rewritten.
-- Keep legacy table names, national-ID uniqueness, RLS, grants and immutable triggers.
ALTER TABLE public.trainee_applications
  ADD COLUMN registration_type varchar(12) NOT NULL DEFAULT 'TRAINEE'
    CHECK (registration_type IN ('TRAINEE','VOLUNTEER')),
  ADD CONSTRAINT application_id_registration_type_unique UNIQUE (id, registration_type);

ALTER TABLE public.trainee_application_versions
  ADD COLUMN registration_type varchar(12) NOT NULL DEFAULT 'TRAINEE'
    CHECK (registration_type IN ('TRAINEE','VOLUNTEER')),
  ADD CONSTRAINT application_version_registration_type_fk
    FOREIGN KEY (application_id, registration_type)
    REFERENCES public.trainee_applications(id, registration_type) ON DELETE RESTRICT,
  DROP CONSTRAINT trainee_application_versions_declarations_check,
  ADD CONSTRAINT application_version_declarations_by_type CHECK (
    jsonb_typeof(declarations) = 'array' AND
    ((registration_type = 'TRAINEE' AND jsonb_array_length(declarations) = 10) OR
     (registration_type = 'VOLUNTEER' AND jsonb_array_length(declarations) BETWEEN 1 AND 100))
  );

ALTER TABLE public.trainee_application_evidence
  ADD COLUMN registration_type varchar(12) NOT NULL DEFAULT 'TRAINEE'
    CHECK (registration_type IN ('TRAINEE','VOLUNTEER')),
  ADD COLUMN signature_purpose varchar(32),
  ADD CONSTRAINT application_evidence_registration_type_fk
    FOREIGN KEY (application_id, registration_type)
    REFERENCES public.trainee_applications(id, registration_type) ON DELETE RESTRICT,
  DROP CONSTRAINT trainee_application_evidence_kind_check,
  DROP CONSTRAINT trainee_application_evidence_check,
  ADD CONSTRAINT application_evidence_kind_by_type CHECK (
    (registration_type = 'TRAINEE' AND kind IN ('PHYSICIAN_SUMMARY','SIGNATURE','REGISTRATION_PDF')) OR
    (registration_type = 'VOLUNTEER' AND kind IN ('POLICE_CLEARANCE','SIGNATURE','REGISTRATION_PDF'))
  ),
  ADD CONSTRAINT application_evidence_mime_by_kind CHECK (
    (kind = 'SIGNATURE' AND mime_type = 'image/png') OR
    (kind IN ('REGISTRATION_PDF','POLICE_CLEARANCE') AND mime_type = 'application/pdf') OR
    (kind = 'PHYSICIAN_SUMMARY' AND mime_type IN ('application/pdf','image/jpeg','image/png'))
  ),
  ADD CONSTRAINT application_signature_purpose_by_type CHECK (
    (registration_type = 'TRAINEE' AND signature_purpose IS NULL) OR
    (registration_type = 'VOLUNTEER' AND
      ((kind = 'SIGNATURE' AND signature_purpose IS NOT NULL AND
        signature_purpose IN ('VOLUNTEER_AGREEMENT','PARENTAL_CONSENT','CONFIDENTIALITY')) OR
       (kind <> 'SIGNATURE' AND signature_purpose IS NULL)))
  );

CREATE INDEX application_type_queue ON public.trainee_applications
  (registration_type, branch_id, status, created_at DESC, id DESC);
CREATE INDEX application_versions_type_owner ON public.trainee_application_versions
  (application_id, registration_type);
CREATE INDEX application_evidence_type_owner ON public.trainee_application_evidence
  (application_id, registration_type);

-- ALTER TABLE retains the existing server-only ACLs and RLS policies. Reassert
-- RLS explicitly; this migration grants no new browser/Data API privileges.
ALTER TABLE public.trainee_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainee_application_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainee_application_evidence ENABLE ROW LEVEL SECURITY;
