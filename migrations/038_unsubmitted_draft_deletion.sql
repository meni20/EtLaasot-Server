-- Irreversible active-system erasure only; historical backups are untouched.
-- All operations are fixed, owner-executed functions in a private schema.
-- Runtime/browser roles receive no general DELETE privilege.
CREATE SCHEMA registration_private;
REVOKE ALL ON SCHEMA registration_private FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA registration_private TO etlaasot_app;
ALTER TABLE public.trainee_applications ADD COLUMN deletion_requested_at timestamptz;
CREATE TABLE public.registration_draft_deletions (
  application_id uuid PRIMARY KEY,
  branch_id varchar(50) NOT NULL REFERENCES public.branch(id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL REFERENCES public."user"(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status varchar(12) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSING','FAILED','COMPLETE')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claim_id uuid, lease_until timestamptz, purge_xid bigint,
  CHECK(status<>'PROCESSING' OR (claim_id IS NOT NULL AND lease_until IS NOT NULL)),
  CHECK((status='COMPLETE')=(completed_at IS NOT NULL))
);
-- Deliberately no application FK: only the content-free deletion audit survives.
ALTER TABLE public.registration_draft_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.registration_draft_deletions FROM PUBLIC,anon,authenticated,service_role,etlaasot_app;
CREATE INDEX registration_draft_deletions_due ON public.registration_draft_deletions(next_attempt_at) WHERE status IN ('PENDING','PROCESSING');

CREATE FUNCTION registration_private.assert_draft_manager(actor uuid, branch varchar) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public."user" u JOIN public.user_roles r ON r."userId"=u.id
    WHERE u.id=actor AND u.is_active AND u."deletedAt" IS NULL AND r."deletedAt" IS NULL
    AND (r."expirationDate" IS NULL OR r."expirationDate">now())
    AND (r."roleId"=10001 OR (r."roleId"=10000 AND r."resourceId"=branch))) THEN
    RAISE EXCEPTION 'Draft manager authorization required' USING ERRCODE='42501';
  END IF;
END $$;
CREATE FUNCTION registration_private.assert_unsubmitted_draft(app uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.trainee_applications a WHERE a.id=app AND a.status='DRAFT'
    AND a.provisioned_user_id IS NULL AND a.reviewed_by IS NULL AND a.reviewed_at IS NULL
    AND a.approved_activity_year_id IS NULL)
    OR EXISTS(SELECT 1 FROM public.trainee_application_versions WHERE application_id=app)
    OR EXISTS(SELECT 1 FROM public.trainee_application_events WHERE application_id=app
      AND action NOT IN ('CREATED','RECOVERED','SESSION_REVOKED'))
    OR EXISTS(SELECT 1 FROM public.trainee_application_evidence WHERE application_id=app AND (version_id IS NOT NULL OR kind='REGISTRATION_PDF'))
    OR EXISTS(SELECT 1 FROM public.onboarding_deliveries WHERE application_id=app)
    OR EXISTS(SELECT 1 FROM public.trainee_application_evidence WHERE application_id=app
      AND (storage_bucket<>'trainee-documents' OR storage_path NOT LIKE 'registration/application/'||app::text||'/%'))
    OR EXISTS(SELECT 1 FROM public.trainee_application_evidence WHERE application_id<>app AND storage_path LIKE 'registration/application/'||app::text||'/%')
    OR EXISTS(SELECT 1 FROM public.registration_form_documents WHERE storage_path LIKE 'registration/application/'||app::text||'/%') THEN
    RAISE EXCEPTION 'Only never-submitted unprovisioned drafts may be deleted' USING ERRCODE='23514';
  END IF;
END $$;
CREATE FUNCTION registration_private.draft_delete_begin(app uuid, actor uuid, revision integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.trainee_applications; j public.registration_draft_deletions;
BEGIN
  -- Credential -> application -> job order matches existing save/recovery.
  PERFORM 1 FROM public.applicant_sessions WHERE application_id=app FOR UPDATE;
  SELECT * INTO a FROM public.trainee_applications WHERE id=app FOR UPDATE;
  SELECT * INTO j FROM public.registration_draft_deletions WHERE application_id=app FOR UPDATE;
  IF a.id IS NULL AND j.application_id IS NULL THEN RAISE EXCEPTION 'Draft not found' USING ERRCODE='P0002'; END IF;
  PERFORM registration_private.assert_draft_manager(actor,coalesce(a.branch_id,j.branch_id));
  IF j.application_id IS NOT NULL THEN
    IF j.status='FAILED' THEN
      UPDATE public.registration_draft_deletions SET status='PENDING',attempts=0,next_attempt_at=now(),claim_id=NULL,lease_until=NULL WHERE application_id=app;
    END IF;
  ELSE
    PERFORM registration_private.assert_unsubmitted_draft(app);
    IF a.revision<>revision OR EXISTS(SELECT 1 FROM public."user" u WHERE u.national_id_hash=a.national_id_hash) THEN
      RAISE EXCEPTION 'Draft revision or account state changed' USING ERRCODE='23514';
    END IF;
    INSERT INTO public.registration_draft_deletions(application_id,branch_id,requested_by) VALUES(app,a.branch_id,actor);
    -- Access dies before any external cleanup. No alternate copy is made.
    UPDATE public.applicant_sessions SET revoked_at=now(),updated_at=now() WHERE application_id=app;
    DELETE FROM public.applicant_sessions WHERE application_id=app;
    UPDATE public.trainee_applications SET deletion_requested_at=now(),draft_data='{}'::jsonb,national_id_encrypted='',updated_at=now() WHERE id=app;
  END IF;
  SELECT * INTO j FROM public.registration_draft_deletions WHERE application_id=app;
  RETURN jsonb_build_object('applicationId',app,'status',j.status);
END $$;
CREATE FUNCTION registration_private.draft_delete_status(app uuid, actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.registration_draft_deletions;
BEGIN
  SELECT * INTO j FROM public.registration_draft_deletions WHERE application_id=app;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deletion not found' USING ERRCODE='P0002'; END IF;
  PERFORM registration_private.assert_draft_manager(actor,j.branch_id);
  RETURN jsonb_build_object('applicationId',app,'status',j.status);
END $$;
CREATE FUNCTION registration_private.draft_delete_eligible(app uuid, actor uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b varchar;
BEGIN
  SELECT branch_id INTO b FROM public.trainee_applications WHERE id=app AND deletion_requested_at IS NULL;
  IF b IS NULL THEN RETURN false; END IF;
  PERFORM registration_private.assert_draft_manager(actor,b);
  PERFORM registration_private.assert_unsubmitted_draft(app);
  RETURN NOT EXISTS(SELECT 1 FROM public."user" u JOIN public.trainee_applications a ON a.national_id_hash=u.national_id_hash WHERE a.id=app);
EXCEPTION WHEN check_violation THEN RETURN false;
END $$;
CREATE FUNCTION registration_private.draft_delete_claim(claim uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE app uuid;
BEGIN
  UPDATE public.registration_draft_deletions SET status='FAILED',claim_id=NULL,lease_until=NULL WHERE status='PROCESSING' AND lease_until<=now() AND attempts>=5;
  SELECT application_id INTO app FROM public.registration_draft_deletions
    WHERE ((status='PENDING' AND next_attempt_at<=now()) OR (status='PROCESSING' AND lease_until<=now())) AND attempts<5
    ORDER BY requested_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF app IS NULL THEN RETURN NULL; END IF;
  UPDATE public.registration_draft_deletions SET status='PROCESSING',attempts=attempts+1,claim_id=claim,lease_until=now()+interval '5 minutes' WHERE application_id=app;
  RETURN app;
END $$;
CREATE FUNCTION registration_private.draft_delete_fail(app uuid, claim uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  UPDATE public.registration_draft_deletions SET status=CASE WHEN attempts>=5 THEN 'FAILED' ELSE 'PENDING' END,
    next_attempt_at=now()+interval '1 minute',claim_id=NULL,lease_until=NULL WHERE application_id=app AND claim_id=claim AND status='PROCESSING';
END $$;
CREATE FUNCTION registration_private.draft_evidence_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='DELETE' AND current_user='postgres' THEN
    IF EXISTS(SELECT 1 FROM public.registration_draft_deletions j JOIN public.trainee_applications a ON a.id=j.application_id
      WHERE j.application_id=OLD.application_id AND a.status='DRAFT' AND a.deletion_requested_at IS NOT NULL
      AND j.status='PROCESSING' AND j.purge_xid=txid_current()) THEN RETURN OLD; END IF;
  END IF;
  RAISE EXCEPTION 'Registration evidence is immutable' USING ERRCODE='23514';
END $$;
-- Only these two trigger bindings change. The shared immutable function,
-- all submitted version triggers and all renewal protections remain intact.
DROP TRIGGER application_evidence_immutable ON public.trainee_application_evidence;
CREATE TRIGGER application_evidence_immutable BEFORE UPDATE OR DELETE ON public.trainee_application_evidence FOR EACH ROW EXECUTE FUNCTION registration_private.draft_evidence_immutable();
DROP TRIGGER application_events_immutable ON public.trainee_application_events;
CREATE TRIGGER application_events_immutable BEFORE UPDATE OR DELETE ON public.trainee_application_events FOR EACH ROW EXECUTE FUNCTION registration_private.draft_evidence_immutable();
CREATE FUNCTION registration_private.freeze_deleting_draft() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF OLD.deletion_requested_at IS NOT NULL THEN RAISE EXCEPTION 'Draft deletion is irreversible and pending' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER freeze_deleting_draft BEFORE UPDATE ON public.trainee_applications FOR EACH ROW EXECUTE FUNCTION registration_private.freeze_deleting_draft();
CREATE FUNCTION registration_private.guard_draft_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  PERFORM 1 FROM public.trainee_applications WHERE id=NEW.application_id AND deletion_requested_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft is unavailable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_draft_evidence_insert BEFORE INSERT ON public.trainee_application_evidence FOR EACH ROW EXECUTE FUNCTION registration_private.guard_draft_insert();
CREATE TRIGGER guard_draft_version_insert BEFORE INSERT ON public.trainee_application_versions FOR EACH ROW EXECUTE FUNCTION registration_private.guard_draft_insert();
CREATE TRIGGER guard_draft_session_insert BEFORE INSERT ON public.applicant_sessions FOR EACH ROW EXECUTE FUNCTION registration_private.guard_draft_insert();
CREATE FUNCTION registration_private.draft_delete_complete(app uuid, claim uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM 1 FROM public.applicant_sessions WHERE application_id=app FOR UPDATE;
  PERFORM 1 FROM public.trainee_applications WHERE id=app FOR UPDATE;
  PERFORM 1 FROM public.registration_draft_deletions WHERE application_id=app AND status='PROCESSING' AND claim_id=claim AND lease_until>now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deletion lease expired' USING ERRCODE='23514'; END IF;
  PERFORM registration_private.assert_unsubmitted_draft(app);
  IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='trainee-documents' AND name LIKE 'registration/application/'||app::text||'/%') THEN
    RAISE EXCEPTION 'Storage cleanup is incomplete' USING ERRCODE='23514';
  END IF;
  UPDATE public.registration_draft_deletions SET purge_xid=txid_current() WHERE application_id=app;
  DELETE FROM public.applicant_sessions WHERE application_id=app;
  DELETE FROM public.trainee_application_evidence WHERE application_id=app;
  DELETE FROM public.trainee_application_events WHERE application_id=app;
  DELETE FROM public.trainee_applications WHERE id=app;
  UPDATE public.registration_draft_deletions SET status='COMPLETE',completed_at=now(),claim_id=NULL,lease_until=NULL,purge_xid=NULL WHERE application_id=app;
END $$;
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='registration_private' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role,etlaasot_app',f.signature);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION registration_private.draft_delete_begin(uuid,uuid,integer),
 registration_private.draft_delete_status(uuid,uuid),registration_private.draft_delete_eligible(uuid,uuid),
 registration_private.draft_delete_claim(uuid),registration_private.draft_delete_fail(uuid,uuid),
 registration_private.draft_delete_complete(uuid,uuid) TO etlaasot_app;
