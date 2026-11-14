-- Preserve the existing worker-only lease and never-submitted draft checks.
CREATE OR REPLACE FUNCTION registration_private.draft_delete_complete(app uuid, claim uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity_hash text;
BEGIN
  PERFORM 1 FROM public.applicant_sessions WHERE application_id=app FOR UPDATE;
  SELECT national_id_hash INTO identity_hash
    FROM public.trainee_applications WHERE id=app FOR UPDATE;
  PERFORM 1 FROM public.registration_draft_deletions WHERE application_id=app AND status='PROCESSING' AND claim_id=claim AND lease_until>now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deletion lease expired' USING ERRCODE='23514'; END IF;
  PERFORM registration_private.assert_unsubmitted_draft(app);
  PERFORM pg_advisory_xact_lock(hashtextextended('application-identity:'||identity_hash,0));
  IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='trainee-documents' AND name LIKE 'registration/application/'||app::text||'/%') THEN
    RAISE EXCEPTION 'Storage cleanup is incomplete' USING ERRCODE='23514';
  END IF;
  UPDATE public.registration_draft_deletions SET purge_xid=txid_current() WHERE application_id=app;
  DELETE FROM public.applicant_sessions WHERE application_id=app;
  DELETE FROM public.trainee_application_evidence WHERE application_id=app;
  DELETE FROM public.trainee_application_events WHERE application_id=app;
  -- Delete only applicant-owned dependencies, leaving user recovery and
  -- approved or historical registration records under their existing protections.
  DELETE FROM public.password_reset_challenges WHERE application_id=app AND user_id IS NULL;
  DELETE FROM public.password_recovery_bindings WHERE application_id=app AND user_id IS NULL;
  DELETE FROM public.application_credentials WHERE application_id=app;
  DELETE FROM public.trainee_applications WHERE id=app;
  UPDATE public.registration_draft_deletions SET status='COMPLETE',completed_at=now(),claim_id=NULL,lease_until=NULL,purge_xid=NULL WHERE application_id=app;
END $$;
