-- Extend the existing renewal status and audit values without rewriting rows.
ALTER TABLE public.registration_forms
  ADD CONSTRAINT registration_forms_renewal_status_check
  CHECK (status IN ('DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED'));
ALTER TABLE public.registration_forms DROP CONSTRAINT registration_forms_status_check;

ALTER TABLE public.registration_form_history
  ADD CONSTRAINT registration_form_history_renewal_action_check
  CHECK (action IN ('DRAFT_CREATED', 'SUBMITTED', 'PDF_GENERATED', 'PDF_FAILED',
    'CHANGES_REQUESTED', 'RESUBMITTED', 'APPROVED', 'INDIVIDUAL_RENEWAL_REQUESTED',
    'ANNUAL_REGISTRATION_OPENED', 'REJECTED'));
ALTER TABLE public.registration_form_history DROP CONSTRAINT registration_form_history_action_check;
