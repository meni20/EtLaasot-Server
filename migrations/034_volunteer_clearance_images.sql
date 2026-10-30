-- LOCAL PREPARATION. Requires 033. No rows, signatures, ACLs, RLS, triggers or
-- Storage settings are modified. Technical validation does not prove authenticity.
ALTER TABLE public.trainee_application_evidence
  DROP CONSTRAINT application_evidence_mime_by_kind,
  ADD CONSTRAINT application_evidence_mime_by_kind CHECK (
    (kind = 'SIGNATURE' AND mime_type = 'image/png') OR
    (kind = 'REGISTRATION_PDF' AND mime_type = 'application/pdf') OR
    (kind IN ('PHYSICIAN_SUMMARY','POLICE_CLEARANCE') AND mime_type IN ('application/pdf','image/jpeg','image/png'))
  );
