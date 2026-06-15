ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS gender varchar(10);

ALTER TABLE "user"
  DROP CONSTRAINT IF EXISTS user_gender_check;

ALTER TABLE "user"
  ADD CONSTRAINT user_gender_check
  CHECK (gender IS NULL OR gender IN ('male', 'female'));
