# Phase 4 — Supabase DEV migration verification

Verified on 2026-10-21 under explicit approval to apply only migration 031 to the existing DEV database. No new database was created.

## Result

`031_parent_applications.sql` was applied successfully to **EtLaasot-dev** only, using the authorized `postgres` migration role through the project-scoped Supabase migration tool.

- Supabase project: `vlysppqfozfiwcmsyban` (`EtLaasot-dev`).
- Supabase migration name/version: `parent_applications_031` / `20261021182151`.
- Application migration history: exactly one `031_parent_applications.sql`; total increased from 32 to 33 entries.
- Migration 030 remains exactly once, with its original Supabase version `20261021160737`. It was not rerun, and its local source is unchanged relative to HEAD.
- Migration 031 source SHA-256 (current Windows working-copy bytes): `D6ED51AC896FC9463AEFD92AB0F7F6F3780AD2E030E274B0EB292196DC365FD9`.
- The applied payload used the reviewed 031 file, transaction-local search path/timeouts, an identity/history/object-existence guard, and an insert recording 031 in the application's migration history. The repository migration file was not edited.

## Database isolation and compatibility

Supabase metadata confirmed distinct DEV and Production projects/hosts: DEV `vlysppqfozfiwcmsyban`, Production `tmlnuqrwhdeplpeuuvwv`. Read-only Railway configuration inspection confirmed their Server configurations point to those respective project references. No SQL connection to Production was made.

The actual Railway DEV runtime credentials were used in memory for authenticated, certificate-validated TLS connections. No root `.env` was loaded and no credentials were written or printed. Every verification connection explicitly entered a READ ONLY transaction before catalog/application reads.

Authenticated DEV identity: database `postgres`, application role `etlaasot_app`, PostgreSQL 17.6, actual server address `2a05:d014:8ef:5902:b67d:7199:8fac:e6d0`, port 5432. The project-scoped migration connection independently returned the same database/server address and the expected `postgres` role. The migration payload guarded these identity fields again before DDL.

Preflight confirmed:

- All six 031 tables and eight explicitly named indexes were absent; 031 was pending and 030 was recorded.
- Existing referenced keys match 031: `branch.id` is varchar(50), `user.id` and `activity_years.id` are UUID primary keys.
- The migration role owns the referenced tables and has CREATE/REFERENCES permissions.
- `etlaasot_app` exists, is neither owner nor superuser nor BYPASSRLS, has public-schema USAGE but not CREATE, and can execute the existing immutable-record trigger function.
- Browser roles and `service_role` are not members of `etlaasot_app`.
- Existing Supabase default table privileges are broad; 031 explicitly revokes PUBLIC/anon/authenticated/service_role access on each new table before granting only the required backend access.
- The trigger function remains SECURITY INVOKER with `search_path=pg_catalog`, unchanged from the preflight definition.

No compatibility correction or modification of existing tables was needed. The isolated fixture is not an exact copy of DEV: notably DEV roles IDs are varchar(255), user-role IDs are integer without the fixture's original role foreign key, and DEV has a partial unique index on non-null user identity hashes rather than the fixture's full unique index. None conflicts with 031's new foreign keys. This catalog check does not establish full runtime provisioning compatibility.

## Post-migration verification

All six new tables are empty and owned by `postgres`:

1. `trainee_applications`
2. `applicant_sessions`
3. `trainee_application_versions`
4. `trainee_application_evidence`
5. `trainee_application_events`
6. `registration_public_limits`

Verified 55 columns and their expected nullability, 51 validated constraints, 22 valid/ready indexes (including primary/unique indexes), six enabled RLS configurations, six backend-only policies and three enabled BEFORE UPDATE OR DELETE immutable-record triggers. Reviewed key definitions include application identity uniqueness, session/recovery hash uniqueness, per-application version/idempotency uniqueness, composite application/version evidence ownership, one PDF per version, ten declarations, approval/review prerequisites, non-empty rejection feedback, MIME/size/hash checks and RESTRICT foreign-key actions.

The actual application role successfully SELECTed all six tables with `row_security_active(...) = true` and without owning them. Its permissions are SELECT/INSERT/UPDATE on applications, sessions and rate limits, and SELECT/INSERT on versions, evidence and events. DELETE/TRUNCATE/REFERENCES/TRIGGER are denied. PUBLIC/anon/authenticated/service_role have no table grants; effective privilege checks also found no SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER access for the three named client/service roles.

Before/after counts and order-independent whole-row fingerprints matched for all 23 pre-existing public tables. For migration history, only the deliberately added 031 entry was excluded from the equality comparison. All **125 users and five branches**, medical records and other existing application rows remained unchanged. Fingerprints and catalog metadata were retained locally without row contents or credentials.

## Tests performed and limits

- Authenticated DEV read-only identity, TLS, role, RLS, ACL, row count and existing-record fingerprint checks: PASS before/after.
- DEV catalog checks for tables, columns, constraints, indexes, policies, triggers and migration history: PASS.
- Read-only equivalent of integration test 6's assertions (non-owner SELECT, active RLS, denied immutable UPDATE): PASS against actual DEV credentials. No mutation was attempted to fire an immutable trigger.
- `npm run test:parent-admission -- --silent`: PASS, 5 suites / 45 tests. These are local unit/component tests, not live PostgreSQL lifecycle tests.
- `npm run typecheck:parent-admission`: PASS.
- `npm run build`: PASS.
- `git diff --check`: PASS (Git emitted existing LF/CRLF conversion notices).

The seven PostgreSQL tests in `test/parent-admission/lifecycle.db-spec.ts` were reviewed, not run. The harness requires a fresh attested local sandbox, executes a synthetic baseline plus 030 and 031, and prepares fictional branches/users/roles. Its safeguards were preserved; no URL/guard was changed to run it against DEV.

| PostgreSQL scenario | Actual DEV verification |
| --- | --- |
| Concurrent approval creates exactly one account/password response | Unverified; requires writes/provisioning |
| Audit failure rolls back account/role/approval | Unverified; requires writes and injected failure |
| Session/recovery credential rotation and revocation | Unverified; requires session writes |
| Concurrent application identity uniqueness | Unique constraint verified; concurrent insert behavior unverified |
| Shared rate limit across service instances | Required key/index/permissions verified; concurrent UPSERT behavior unverified |
| Non-owner RLS and immutable ACL access | Read-only assertions passed; original fixture test not executed |
| Annual blocking, current-year exemption and individual blocking choices | Unverified on DEV; requires fixture users/periods/applications and enabled test flags |

No baseline, fixture DML, historical migration, normal migration runner, application startup or real registration request was executed against DEV.

## Flags and remaining deployment work

Read-only Railway inspection confirmed Server `PARENT_REGISTRATION_ENABLED=false` and `PARENT_REGISTRATION_BLOCKING_ENABLED=false`. `ID_FIRST_LOGIN_ENABLED`, `APPLICANT_REGISTRATION_ENABLED` and `PARENT_ADMISSION_SCHEMA_READY` remain unset (default false). Client `VITE_PARENT_REGISTRATION_ENABLED=false`; new ID-first, applicant and blocking flags remain unset (default false). No variable was changed. Existing login behavior remains unchanged.

The DEV schema is prepared for 031, but this does not establish end-to-end Phase 4 readiness. Before deploying code, review the uncommitted Server/Client changes and authorize the DEV Git/deployment steps separately. Before enabling features, resolve the unverified write/concurrency scenarios using a separately approved, DEV-safe fixture/test approach, and complete/verify the evidence upload/PDF integration: the current unavailable evidence gateway deliberately prevents live submission/approval. Merely applying 031 does not enable that integration or any feature flag.

No commit, push, merge, deployment, Production SQL, Storage change, encryption-key change, Railway variable/service change, table reset/drop or existing-record deletion was performed. Documents was untouched. Phase 4 remains uncommitted on the local feature branches.

## Local artifacts created by this task

- This report (untracked).
- Ignored `.tmp/phase4-dev-check.cjs`: credential-free read-only verification helper; obtains runtime variables only through stdin.
- Ignored `.tmp/parent-applications-dev-migration-20261021/before-runtime.json` and `after-runtime.json`: safe identities, flags, counts and fingerprints.
- Ignored `.tmp/parent-applications-dev-migration-20261021/catalog-after.json`: schema/ACL verification evidence without application row contents.

No implementation source or migration SQL file was changed by this task.
