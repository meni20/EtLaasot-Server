-- PREPARED ONLY. Requires 039. Do not execute without separate approval.
-- Supports token-free approval mail using the existing durable delivery queue.
-- Existing rows remain PASSWORD_SETUP with all original credential constraints.
ALTER TABLE public.onboarding_deliveries ADD COLUMN delivery_kind varchar(24)
  NOT NULL DEFAULT 'PASSWORD_SETUP'
  CHECK (delivery_kind IN ('PASSWORD_SETUP','APPROVAL_NOTICE'));

-- Replace only the known 037 payload check. Fail closed on schema drift.
DO $payload$
DECLARE payload_name text; matches integer;
BEGIN
  SELECT count(*),min(conname::text) INTO matches,payload_name
  FROM pg_constraint
  WHERE conrelid='public.onboarding_deliveries'::regclass AND contype='c'
    AND pg_get_constraintdef(oid) LIKE '%token_ciphertext IS NULL%'
    AND pg_get_constraintdef(oid) LIKE '%credential_hash IS NOT NULL%'
    AND pg_get_constraintdef(oid) LIKE '%expires_at IS NOT NULL%';
  IF matches<>1 THEN RAISE EXCEPTION 'Unexpected onboarding payload constraint; stop for review'; END IF;
  EXECUTE format('ALTER TABLE public.onboarding_deliveries DROP CONSTRAINT %I',payload_name);
END $payload$;

ALTER TABLE public.onboarding_deliveries ADD CONSTRAINT onboarding_delivery_payload CHECK (
  (delivery_kind='PASSWORD_SETUP' AND (
    (status='SKIPPED' AND token_hash IS NULL AND token_ciphertext IS NULL) OR
    (status<>'SKIPPED' AND token_hash IS NOT NULL AND credential_hash IS NOT NULL AND expires_at IS NOT NULL)
  )) OR
  (delivery_kind='APPROVAL_NOTICE' AND token_hash IS NULL AND token_ciphertext IS NULL
    AND credential_hash IS NULL AND expires_at IS NULL AND consumed_at IS NULL)
);
-- No new grants, policies or email-verification tokens. Existing RLS applies.
