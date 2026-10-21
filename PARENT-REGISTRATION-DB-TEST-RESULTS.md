# Phase 2 isolated PostgreSQL integration results — 2026-10-20

**Result: migration 030 succeeded; all six database integration tests passed.**

Work remains on `feature/parent-registration-backend`. No commit, push, merge or deployment occurred.

## Verified target and retained resources

- PostgreSQL 17.2, exclusively `127.0.0.1:55439`.
- Data directory: `C:\Users\User\Et-Laasot-2\EtLaasot-Server\.tmp\parent-registration-postgres-20261020-a`.
- Executable: `C:\Program Files\PostgreSQL\17\bin\postgres.exe`.
- Listener PID 10028 matched the manifest, postmaster PID file and executable/data-directory process identity.
- Actual socket address/port, actual SQL database/role/data directory, cluster name, cluster system identifier, PostgreSQL major version and sandbox nonce were verified. Nonce values and credentials were not logged.
- Dedicated non-superuser role: `etlaasot_test_runner`, with no CREATEDB, CREATEROLE, REPLICATION or BYPASSRLS. Its `pg_read_all_settings` membership permits read-only data-directory attestation in this isolated cluster.
- First attempt: `etlaasot_parent_registration_test_20261020_a`, retained.
- Successful clean rerun: `etlaasot_parent_registration_test_20261020_a_r2`, retained.
- Authentication remains SCRAM-SHA-256. Credentials remain CurrentUser DPAPI-encrypted in the private, Git-ignored sandbox directory. The sandbox was not restarted or deleted during this test run.

All connections were restricted to this verified cluster. No connections or changes were made to PostgreSQL ports 5432/5433, the old `.local-postgres` cluster, existing application databases, Supabase, Railway or other external services. Existing Client/Documents code and application environment files were not changed.

## Commands and migration outcome

The dedicated harness was used exclusively for database provisioning, migration and test execution:

```powershell
$env:PHASE2_TEST_APPROVED = 'isolated-local-only'
npm run test:parent-registration:db -- --prepare-recovered-and-execute
# After fixing the test-only assertion below, preserve the first DB and rerun fresh:
npm run test:parent-registration:db -- --new-test-database-and-execute
```

Each run attested its connections, required an empty test database, then committed the synthetic baseline, **only** `migrations/030_parent_registration.sql`, and the sandbox marker in one transaction. Migration 030 completed successfully on both attempts. No historical migration, normal migration runner, Sequelize schema sync, seed command or main application startup was executed.

The baseline creates synthetic current user/branch/role/medication tables, not copies of application data. All fixture records are fictional.

## Six integration results

| Test | Final result | Checks exercised |
| --- | --- | --- |
| Annual registration and newcomers | PASS | Branch-local period, immediate newcomer requirement, no other-branch requirement, unauthorized administrator denied |
| JWT HTTP drafts and competing revisions | PASS | JWT required, client-supplied identity rejected, persisted draft, exactly one competing autosave succeeds |
| Concurrent idempotent two-parent submission | PASS | Verified fixture references, ownership, one snapshot under concurrent retries, encrypted IDs, approval blocked without PDF |
| Immutable evidence and branch isolation | PASS | SQL version UPDATE/DELETE rejected, history UPDATE rejected, RLS enabled on all six new tables, other-branch review denied, super-admin access |
| Request changes and resubmission | PASS | Signatures removed, changed draft, fresh completed signature reference, second immutable version, original evidence unchanged |
| Transactional approval and medical preservation | PASS | Deliberate audit failure rolls profile/status back, later approval succeeds, original allergies and medication survive, annual restriction resolves, nonblocking individual renewal preserves approved evidence |

Final Jest result: **1 suite passed; 6 tests passed; 0 failed**, approximately 18 seconds. Feature type checking also passed: `npm run typecheck:parent-registration`. Node syntax checks for the changed CJS helpers and `git diff --check` passed.

## Issue discovered and corrections

The first run passed five tests. The annual-registration test correctly received a synchronous ForbiddenException from `openPeriod` for an out-of-branch administrator, but its assertion incorrectly used Jest's Promise `.rejects` matcher. The test now asserts the synchronous throw. No production business-logic change or authorization relaxation was required. The clean rerun passed all six tests.

Two safety improvements were made before/alongside testing:

1. Recovered bootstrap provisioning is an explicit mode that attests the administrator connection before creating only the dedicated test role/database. The bootstrap-only credential flag prevents accidentally attempting tests before those resources exist.
2. Sequelize sends setup/catalog queries before `afterConnect`. The test dialect now wraps the pg client's connection completion so full attestation happens **before** Sequelize's startup SQL; the existing afterConnect check remains too. Failed OS/connection attestations immediately terminate the test child rather than becoming a normal failed assertion that Jest could continue past. No actual isolation verification failed during these runs.

Files changed in this test task:

- `scripts/parent-registration-sandbox.cjs`
- `scripts/parent-registration-test-safety.cjs`
- `scripts/test-parent-registration-db.cjs`
- `test/parent-registration/lifecycle.db-spec.ts`
- `PARENT-REGISTRATION-PHASE2.md` — links this current result from the original preparation record.
- `PARENT-REGISTRATION-DB-TEST-RESULTS.md` — this report.

The migration, synthetic baseline, legal declarations and production Phase 2 business logic were unchanged in this test task.

## Local frontend integration readiness

The implemented draft/status/feedback/admin-review API behavior and transactional persistence are ready to wire into a local frontend. These tests establish the backend component contract against real isolated PostgreSQL, including the existing JWT strategy/guard with a synthetic account lookup.

A persistent, safely isolated local API startup path still needs preparation before connecting a frontend: the ordinary application environment loader selects an existing Dev/Production target and must not be used for this sandbox unchanged. No frontend-test server was started by this task.

The integration runner intentionally uses ephemeral in-memory JWT/encryption keys. The databases remain inspectable through their retained database credentials, but a future persistent frontend sandbox needs its own retained local test keys and fresh matching fixtures; it should not assume it can decrypt the current run's evidence with another key.

Real physician/signature uploads, authorized attachment viewing and Documents/PDF generation remain deferred. The suite uses explicitly test-only verified reference metadata to exercise the later approval path; it does not prove real private Storage uploads or PDF generation. Real submission/approval remains safely blocked without those integrations. Existing application blocking remains disabled and unwired.

The synthetic prerequisite baseline does not validate replaying all historical migrations or a Supabase deployment's complete privilege/storage configuration.
