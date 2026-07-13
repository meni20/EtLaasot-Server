ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS archived_by uuid NULL,
  ADD COLUMN IF NOT EXISTS archive_reason text NULL;

ALTER TABLE "user"
  DROP CONSTRAINT IF EXISTS user_archived_by_fkey;

ALTER TABLE "user"
  ADD CONSTRAINT user_archived_by_fkey
  FOREIGN KEY (archived_by)
  REFERENCES "user"(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_is_active
  ON "user" (is_active);

CREATE INDEX IF NOT EXISTS idx_user_branch_active
  ON "user" ("branchId", is_active);
