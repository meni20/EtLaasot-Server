-- PREPARED ONLY: requires explicit approval before applying to Supabase DEV.
-- Permit byte-validated medical JPEG/PNG uploads while preserving signature/PDF rules.
-- No rows, grants, RLS policies, triggers, keys or Storage settings are changed.
ALTER TABLE public.registration_form_documents
  DROP CONSTRAINT registration_form_documents_check,
  ADD CONSTRAINT registration_form_documents_check CHECK (
    (kind = 'SIGNATURE' AND mime_type = 'image/png') OR
    (kind = 'REGISTRATION_PDF' AND mime_type = 'application/pdf') OR
    (kind = 'PHYSICIAN_SUMMARY' AND mime_type IN ('application/pdf','image/jpeg','image/png'))
  );
ALTER TABLE public.trainee_application_evidence
  DROP CONSTRAINT trainee_application_evidence_check,
  ADD CONSTRAINT trainee_application_evidence_check CHECK (
    (kind = 'SIGNATURE' AND mime_type = 'image/png') OR
    (kind = 'REGISTRATION_PDF' AND mime_type = 'application/pdf') OR
    (kind = 'PHYSICIAN_SUMMARY' AND mime_type IN ('application/pdf','image/jpeg','image/png'))
  );
