-- Keep financial evidence outside every annual-registration table and bucket.
CREATE TABLE public.discount_requests (
  trainee_id uuid PRIMARY KEY REFERENCES public."user"(id),
  enabled_by uuid NOT NULL REFERENCES public."user"(id),
  enabled_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  form_data jsonb NOT NULL DEFAULT '{}',
  attachments jsonb NOT NULL DEFAULT '{}',
  submitted_at timestamptz,
  evidence jsonb,
  CHECK (jsonb_typeof(form_data) = 'object' AND jsonb_typeof(attachments) = 'object'),
  CHECK ((submitted_at IS NULL) = (evidence IS NULL))
);

CREATE INDEX discount_requests_enabled_by_idx ON public.discount_requests (enabled_by);
ALTER TABLE public.discount_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.discount_requests FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.discount_requests TO etlaasot_app;
GRANT UPDATE (revision, form_data, attachments, submitted_at, evidence)
  ON public.discount_requests TO etlaasot_app;
CREATE POLICY discount_server_select ON public.discount_requests FOR SELECT TO etlaasot_app USING (true);
CREATE POLICY discount_server_enable ON public.discount_requests FOR INSERT TO etlaasot_app
  WITH CHECK (submitted_at IS NULL AND revision = 0 AND form_data = '{}' AND attachments = '{}');
CREATE POLICY discount_server_draft_update ON public.discount_requests FOR UPDATE TO etlaasot_app
  USING (submitted_at IS NULL) WITH CHECK (true);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('discount-request-private', 'discount-request-private', false, 10485760,
        ARRAY['application/pdf','image/jpeg','image/png','image/webp']);

-- A permissive policy from another feature must never grant access to these objects.
CREATE POLICY discount_objects_server_only ON storage.objects AS RESTRICTIVE
  FOR ALL TO PUBLIC
  USING (bucket_id <> 'discount-request-private' OR current_user = 'service_role')
  WITH CHECK (bucket_id <> 'discount-request-private' OR current_user = 'service_role');
