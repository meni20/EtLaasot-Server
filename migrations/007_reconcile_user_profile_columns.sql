ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS gender varchar(10),
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS shirt_size varchar(10),
  ADD COLUMN IF NOT EXISTS custom_shirt_size varchar(50),
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS parent_name varchar(100);

ALTER TABLE "user"
  DROP CONSTRAINT IF EXISTS user_gender_check;

ALTER TABLE "user"
  ADD CONSTRAINT user_gender_check
  CHECK (gender IS NULL OR gender IN ('male', 'female'));

ALTER TABLE "user"
  DROP CONSTRAINT IF EXISTS user_shirt_size_check;

ALTER TABLE "user"
  ADD CONSTRAINT user_shirt_size_check
  CHECK (
    shirt_size IS NULL OR
    shirt_size IN ('XS', 'S', 'M', 'L', 'XL', 'XXL', 'OTHER')
  );
