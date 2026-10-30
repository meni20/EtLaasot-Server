-- Local preparation only; requires 033/034. Existing immutable rows are untouched.
ALTER TABLE public.trainee_application_evidence
  ADD COLUMN template_version varchar(50),
  ADD COLUMN source_checksum varchar(64),
  ADD COLUMN generated_at timestamptz,
  ADD CONSTRAINT volunteer_pdf_metadata CHECK (
    registration_type <> 'VOLUNTEER' OR kind <> 'REGISTRATION_PDF' OR
    (template_version IS NOT NULL AND template_version = 'volunteer-registration/v1'
      AND source_checksum IS NOT NULL AND source_checksum ~ '^[a-f0-9]{64}$'
      AND generated_at IS NOT NULL)
  );
ALTER TABLE public.trainee_application_events
  ADD COLUMN version_id uuid,
  ADD CONSTRAINT application_event_version_fk FOREIGN KEY(application_id,version_id)
    REFERENCES public.trainee_application_versions(application_id,id) ON DELETE RESTRICT,
  DROP CONSTRAINT trainee_application_events_action_check,
  ADD CONSTRAINT application_event_action CHECK(action IN
    ('CREATED','SUBMITTED','CHANGES_REQUESTED','REJECTED','APPROVED','RECOVERED','SESSION_REVOKED','PDF_GENERATED','PDF_FAILED'));
CREATE INDEX application_events_version ON public.trainee_application_events(application_id,version_id);
-- Existing grants, RLS and immutable triggers are retained. No Storage changes.
