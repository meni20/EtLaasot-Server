CREATE TABLE IF NOT EXISTS calendar_month_background (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "branchId" varchar(50) NOT NULL,
  month_key varchar(7) NOT NULL,
  image_path text NOT NULL,
  uploaded_by uuid NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_month_background_branch_fkey
    FOREIGN KEY ("branchId")
    REFERENCES branch(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT calendar_month_background_uploaded_by_fkey
    FOREIGN KEY (uploaded_by)
    REFERENCES "user"(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  CONSTRAINT calendar_month_background_month_key_check
    CHECK (month_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);

CREATE UNIQUE INDEX IF NOT EXISTS calendar_month_background_branch_month_unique
  ON calendar_month_background ("branchId", month_key);

CREATE INDEX IF NOT EXISTS idx_calendar_month_background_branch
  ON calendar_month_background ("branchId");
