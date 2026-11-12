-- Preserve existing trainee versions and enforce the owning renewal type.
ALTER TABLE public.registration_form_versions
  ADD COLUMN registration_type varchar(12) NOT NULL DEFAULT 'TRAINEE',
  ADD CONSTRAINT registration_renewal_version_owner_type
    FOREIGN KEY (form_id, registration_type)
    REFERENCES public.registration_forms (id, registration_type) ON DELETE RESTRICT,
  ADD CONSTRAINT registration_renewal_version_declarations CHECK (
    jsonb_typeof(declarations) = 'array' AND (
      (registration_type = 'TRAINEE' AND jsonb_array_length(declarations) = 10)
      OR (registration_type = 'VOLUNTEER' AND jsonb_array_length(declarations) BETWEEN 1 AND 100)
    )
  );
ALTER TABLE public.registration_form_versions
  DROP CONSTRAINT registration_form_versions_declarations_check;
