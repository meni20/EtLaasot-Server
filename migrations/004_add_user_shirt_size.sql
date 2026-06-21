ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS shirt_size varchar(10),
  ADD COLUMN IF NOT EXISTS custom_shirt_size varchar(50);

ALTER TABLE "user"
  DROP CONSTRAINT IF EXISTS user_shirt_size_check;

ALTER TABLE "user"
  ADD CONSTRAINT user_shirt_size_check
  CHECK (
    shirt_size IS NULL OR
    shirt_size IN ('XS', 'S', 'M', 'L', 'XL', 'XXL', 'OTHER')
  );
