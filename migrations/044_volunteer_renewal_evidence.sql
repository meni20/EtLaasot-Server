-- Extend existing renewal evidence without changing document contents or permissions.
ALTER TABLE public.registration_forms
  ADD COLUMN registration_type varchar(12) NOT NULL DEFAULT 'TRAINEE'
    CHECK (registration_type IN ('TRAINEE', 'VOLUNTEER')),
  ADD CONSTRAINT registration_forms_id_type_key UNIQUE (id, registration_type);

ALTER TABLE public.registration_form_documents
  ADD COLUMN registration_type varchar(12) NOT NULL DEFAULT 'TRAINEE',
  ADD COLUMN signature_purpose varchar(32),
  ADD COLUMN content_hash varchar(64),
  ADD COLUMN template_version varchar(50),
  ADD COLUMN source_checksum varchar(64),
  ADD COLUMN generated_at timestamptz,
  ADD CONSTRAINT registration_renewal_document_owner_type
    FOREIGN KEY (form_id, registration_type)
    REFERENCES public.registration_forms (id, registration_type) ON DELETE RESTRICT,
  ADD CONSTRAINT registration_renewal_document_kind CHECK (
    (registration_type = 'TRAINEE' AND kind IN ('REGISTRATION_PDF', 'PHYSICIAN_SUMMARY', 'SIGNATURE'))
    OR (registration_type = 'VOLUNTEER' AND kind IN ('REGISTRATION_PDF', 'POLICE_CLEARANCE', 'SIGNATURE'))
  ),
  ADD CONSTRAINT registration_renewal_document_mime CHECK (
    (kind = 'SIGNATURE' AND mime_type = 'image/png')
    OR (kind = 'REGISTRATION_PDF' AND mime_type = 'application/pdf')
    OR (kind IN ('PHYSICIAN_SUMMARY', 'POLICE_CLEARANCE') AND mime_type IN ('application/pdf', 'image/jpeg', 'image/png'))
  ),
  ADD CONSTRAINT registration_renewal_volunteer_document_integrity CHECK (
    registration_type = 'TRAINEE' OR (
      content_hash IS NOT NULL AND content_hash ~ '^[a-f0-9]{64}$'
      AND CASE kind
        WHEN 'SIGNATURE' THEN signature_purpose IS NOT NULL
          AND signature_purpose IN ('VOLUNTEER_AGREEMENT', 'PARENTAL_CONSENT', 'CONFIDENTIALITY')
        WHEN 'REGISTRATION_PDF' THEN signature_purpose IS NULL
          AND template_version IS NOT NULL AND generated_at IS NOT NULL
          AND source_checksum IS NOT NULL AND source_checksum ~ '^[a-f0-9]{64}$'
        ELSE signature_purpose IS NULL
      END
    )
  );

ALTER TABLE public.registration_form_documents
  DROP CONSTRAINT registration_form_documents_kind_check,
  DROP CONSTRAINT registration_form_documents_check;
