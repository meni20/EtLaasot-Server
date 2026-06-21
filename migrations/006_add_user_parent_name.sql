ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS parent_name varchar(100);
