CREATE TABLE trainee_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainee_uuid uuid NOT NULL REFERENCES "user"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  document_type varchar(32) NOT NULL,
  storage_path varchar(200) NOT NULL,
  original_filename varchar(255) NOT NULL,
  mime_type varchar(64) NOT NULL,
  file_size integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trainee_documents_trainee_type_key UNIQUE (trainee_uuid, document_type),
  CONSTRAINT trainee_documents_storage_path_key UNIQUE (storage_path),
  CONSTRAINT trainee_documents_type_check CHECK (document_type IN ('MAGNETIC_CARD', 'ID_APPENDIX', 'QUEUE_EXEMPTION')),
  CONSTRAINT trainee_documents_mime_check CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  CONSTRAINT trainee_documents_size_check CHECK (file_size > 0 AND file_size <= 10485760),
  CONSTRAINT trainee_documents_filename_check CHECK (length(btrim(original_filename)) > 0),
  CONSTRAINT trainee_documents_path_check CHECK (length(btrim(storage_path)) > 0)
);

-- Access is through NestJS using its own JWT/branch authorization, not Supabase Auth.
ALTER TABLE trainee_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE trainee_documents FROM PUBLIC, anon, authenticated;
