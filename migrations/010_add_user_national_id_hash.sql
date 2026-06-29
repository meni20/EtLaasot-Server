CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS national_id_hash varchar(64),
  ADD COLUMN IF NOT EXISTS national_id_last4 varchar(4);

DO $$
DECLARE
  hash_secret text := current_setting('app.national_id_hash_secret', true);
  invalid_user_count integer;
BEGIN
  IF hash_secret IS NULL OR length(trim(hash_secret)) = 0 THEN
    RAISE EXCEPTION 'Missing required migration setting: app.national_id_hash_secret';
  END IF;

  SELECT count(*)
  INTO invalid_user_count
  FROM "user"
  WHERE national_id_hash IS NULL
    AND regexp_replace(id, '[^0-9]', '', 'g') !~ '^\d{5,9}$';

  IF invalid_user_count > 0 THEN
    RAISE EXCEPTION 'Cannot backfill national_id_hash: % user id values are not valid national ID-shaped values', invalid_user_count;
  END IF;

  UPDATE "user"
  SET
    national_id_hash = COALESCE(
      national_id_hash,
      encode(
        hmac(
          lpad(regexp_replace(id, '[^0-9]', '', 'g'), 9, '0'),
          hash_secret,
          'sha256'
        ),
        'hex'
      )
    ),
    national_id_last4 = COALESCE(
      national_id_last4,
      right(lpad(regexp_replace(id, '[^0-9]', '', 'g'), 9, '0'), 4)
    )
  WHERE national_id_hash IS NULL
     OR national_id_last4 IS NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_national_id_hash_unique
  ON "user" (national_id_hash)
  WHERE national_id_hash IS NOT NULL;
