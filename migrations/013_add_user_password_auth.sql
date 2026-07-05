ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS failed_login_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS temporary_password_expires_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = '"user"'::regclass
      AND conname = 'user_failed_login_attempts_nonnegative'
  ) THEN
    ALTER TABLE "user"
      ADD CONSTRAINT user_failed_login_attempts_nonnegative
      CHECK (failed_login_attempts >= 0);
  END IF;
END $$;
