# Parent Registration Phases 2–3 — authorized DEV rollout

Date: 2026-10-21. The user approved applying only migration 030 to the verified Supabase DEV project and committing/pushing the Server and Client features to their respective `dev` branches, triggering the existing Railway DEV deployments. The user explicitly waived a database backup and restore rehearsal because DEV contains disposable test data. No backup or restore rehearsal was performed.

## Database result

- Target: `EtLaasot-dev`, project `vlysppqfozfiwcmsyban`; separate from Production project `tmlnuqrwhdeplpeuuvwv`.
- Railway's existing DEV application connection was attested using certificate-validated TLS and an explicit `BEGIN READ ONLY` transaction. Database `postgres`, application role `etlaasot_app`, port 5432 and the server address matched the DEV-scoped Supabase connector. The application role cannot create public schema objects.
- Migration role: existing authorized `postgres` owner through the DEV-scoped Supabase migration API. No application password, role, encryption key, Storage setting or Production database was changed.
- Applied only `030_parent_registration.sql`, SHA-256 `54026d76c6be718010003c30d666df7670eff3a390ea9386596522030ab7fe5a`, plus its application migration-history entry. Supabase history version: `20261021160737`, name `parent_registration_030`.
- Application history now has 32 entries and exactly one 030 entry. All repository prerequisites through 029 were already present. No historical migration or synthetic baseline was run.
- Verified six new tables, 25 valid/ready indexes, 55 validated constraints, six server-only RLS policies, three enabled immutable-record triggers and the invoker trigger function with restricted EXECUTE privileges.
- All six tables enable RLS. `etlaasot_app` has SELECT/INSERT/UPDATE/DELETE on the three mutable tables and SELECT/INSERT on the three immutable evidence tables. No TRUNCATE/REFERENCES/TRIGGER grants. PUBLIC, anon, authenticated and service_role have no table access; the three client roles also have no function EXECUTE access or membership in the application role.
- All six new tables are empty. Existing user count (125) and branch count (5) were unchanged. The migration contains no existing-table data mutation, reset, drop, delete or seed.

The temporary audit helper initially used `DB_PASSWORD` instead of the application's `DB_PASS`; it was corrected without changing credentials. The pooler did not preserve a startup `default_transaction_read_only` option, so the successful attestation used an explicit read-only SQL transaction and verified its mode. No migration ran before the full attestation passed; no safeguard was weakened.

## Release behavior

The source is integrated for DEV with `PARENT_REGISTRATION_ENABLED=false`, `PARENT_REGISTRATION_BLOCKING_ENABLED=false`, `DB_SYNC=false` and `DB_LOGGING=false` on Server. Client uses `VITE_PARENT_REGISTRATION_ENABLED=false`, explicit DEV environment and the matching existing DEV Server URL. These non-secret settings must be applied only to the existing DEV services, without triggering a premature deployment; the reviewed `dev` pushes trigger deployments in Server-then-Client order.

Existing login and authentication routing remain unchanged. Registration routes/models are not loaded while disabled; live access blocking remains unwired/disabled. No independent applicant registration, ID-first login, trainee-account creation or automatic password email is introduced. Real upload, submission/PDF and approval dependencies remain deferred or accurately unavailable. Demo HTML and mock fixtures must remain excluded from the production build output.

## Validation before release

- Server production build and Phase 2 typecheck: passed.
- Server full regression suite: 40 suites, 282 tests passed.
- Local, non-DB sandbox-attestation unit tests: 13 passed.
- Client registration typecheck and scoped lint: passed.
- Client model/API/environment tests: 11 passed.
- Client production build and demo/mock exclusion check: passed. Existing large-chunk advisory remains.
- Client Playwright UX suite: all 14 tests passed using installed Chrome and fictional local mock data; no external requests or runtime errors in the preview checks.
- The prior six synthetic sandbox integration tests are historical; they are not claimed as new tests against actual DEV. No test registration, trainee, medical record, upload or PDF was created in actual DEV.

The final deployment report must separately record the exact pushed commits, Railway deployment IDs/statuses, read-only/unauthenticated health checks and the local Playwright result. No authenticated user login should be used for smoke testing because it can update existing authentication data.

## Recovery and Phase 4

If a DEV deployment fails, stop and report its precise cause. Do not reset or drop database objects automatically. A code rollback can redeploy the previous reviewed DEV commit with both registration flags off; leave the additive 030 schema in place. Any destructive database repair needs separate approval. Do not use the normal `npm run migrate` runner for remediation.

Phase 4 still needs reviewed applicant/account schema support, ID-first discovery and unchanged existing-user password authentication, active-branch selection, branch-admin review, approval-triggered account provisioning through the existing temporary-password/mandatory-change mechanism, annual and configurable individual renewal blocking, real upload/PDF integration and later automatic email delivery. The current schema's required existing trainee UUID does not implement independent pre-account registration.

Documents, Supabase Storage, encryption keys, `main` branches and Production deployments/databases are outside this rollout.
