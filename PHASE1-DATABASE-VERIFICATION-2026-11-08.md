# Phase 1 database verification — hosted rollout stopped before mutation

Historical report: the stopped attempt below was superseded on 2026-11-09 by the
user's explicit waiver of a new DEV backup. Migration 039 was subsequently applied
only to `vlysppqfozfiwcmsyban`; all existing data fingerprints across 14 tables
were unchanged. Schema readiness is true on Server DEV; password authentication
remains false. The original findings and audit trail below are retained.

Date: 2026-11-08, Asia/Jerusalem.
Worktree: `C:\Users\User\Et-Laasot-2\.tmp\applicant-credentials-phase1-server`.
The user-supplied `Et-Laasot-2.tmp` path does not exist; the existing `.tmp` worktree was used.

## Outcome

Migration 039 passed 22 real isolated PostgreSQL checks. Hosted rollout stopped
at the backup gate: the existing DEV server database role cannot SELECT
`public.registration_draft_deletions`. This is an intentional restriction from
migration 038, not evidence of corruption or a failure in migration 039.

The user explicitly required stopping before hosted mutation/deployment if an
unexpected issue occurred. No permission grants were changed, no table was
omitted to weaken the backup, and no elevated database mutation was attempted.
The failed backup attempts produced no usable database archive or manifest.
The incomplete private backup directories contain only the public TLS CA certificate.

**Not performed:** DEV migration, feature-flag updates, commit, push or deployment.
All original local changes and worktrees were retained. Production, main,
Production databases/Storage, Client, Documents and branding remain unchanged.

## Verified hosted identities (read-only)

| Target | Identity |
| --- | --- |
| Supabase project | `EtLaasot-dev`, `vlysppqfozfiwcmsyban` |
| Supabase status/version | ACTIVE_HEALTHY; PostgreSQL 17.6.1.155 |
| Railway project | `e950a261-d932-48c2-bc19-86287cb374ef` |
| Railway environment | `dev`, `6b2b0ac3-9131-454c-9a42-4df26937f521` |
| Railway Server DEV | `019690d4-5b69-4bff-b685-69c84053f85e` |
| Source | `meni20/EtLaasot-Server`, branch `dev` |
| Current commit | `7ff5c6d323bc73cd304f14764a032c688a68d457` |
| Existing deployment | `e8c7916a-1d95-4960-b429-c18911999837`, SUCCESS |
| Database connection | DEV pooler, `etlaasot_app.vlysppqfozfiwcmsyban`, certificate-verified TLS |

Both `APPLICANT_PASSWORD_AUTH_ENABLED` and
`APPLICATION_CREDENTIALS_SCHEMA_READY` were unset, which means false. They were
left unchanged; schema readiness was not set true because 039 was not applied.
The DEV preflight found no `application_credentials` table and zero records for
`039_application_credentials.sql` in `public.schema_migrations`.

DEV contained 27 applications: 11 DRAFT, 3 PENDING_REVIEW, 3 REJECTED and 10 APPROVED.
The relevant DEV columns matched migration prerequisites: branch and recovery
fields remain NOT NULL before 039, and `registration_private` already exists.

## Migration review

Reviewed file: `migrations/039_application_credentials.sql`.
SHA-256: `1ebf243916fe32f4766759040cf43737bf72d1bf9cd88721547fd59c330e2948`.

- Adds one credential table, server-only grants/RLS, uniqueness, restrictive FKs,
  immutable identity association and transaction-level identity guards.
- Preserves existing row values, passwords, recovery codes, evidence and history.
- Allows branchless DRAFT only, with branch required in all subsequent states.
- Allows null recovery hash/expiry together for password sessions, without
  rewriting existing recovery credentials.
- Email is nonunique and explicitly unverified; no email tokens or mail delivery.
- Existing legacy user provisioning remains permitted. Credential-bearing
  applicants require the future existing-hash approval transfer and remain disabled.
- The SQL is forward-only, not raw-idempotent. Migration-history replay skips it;
  an accidental raw second execution fails and rolls back without data changes.

## Real PostgreSQL verification

Runner added: `scripts/test-applicant-credentials-database.cjs`.
Command: `node scripts/test-applicant-credentials-database.cjs --execute`.
Default without `--execute` is plan-only.

Fresh cluster: PostgreSQL 17.2, pinned to 127.0.0.1 on a dynamically allocated
port. Its `data_directory`, database and address were checked before schema SQL.
The representative schema used the existing synthetic baseline plus actual
migrations 030-038. No DEV personal data or Production connection was used.
Ten synthetic legacy applications covered both registration types and all five
states, with old accounts/password values, sessions, versions, PDF evidence and
history. Test pools used `SET ROLE etlaasot_app` to exercise actual server RLS.
The local cluster was stopped after verification; its files were retained.

All 22 checks passed:

1. Atomic application of 039 against the representative schema.
2. Unchanged legacy table counts and full-row digests across migration.
3. Safe skip on tracked replay.
4. Atomic rejection of untracked raw replay.
5. anon denied credential SELECT.
6. authenticated denied credential SELECT.
7. service_role denied credential SELECT.
8. Real service signup stores an Argon2id hash and creates only an applicant session.
9. RLS hides existing credential rows even under a temporary local browser SELECT grant.
10. Real service login rotates its session and leaves recovery fields null.
11. Trainee and volunteer applicants can share a normalized family email.
12. Parallel real signup commits exactly one identity.
13. Duplicate signup and wrong-password login fail safely.
14. Database rejects branchless submitted applications.
15. Database rejects mismatched application/credential identities.
16. Database rejects plaintext hash storage and verified-email flags.
17. Legacy recovery rows remain intact after new signups.
18. Existing legacy temporary-password provisioning remains permitted.
19. Manual user creation cannot take a credential-bearing identity.
20. User-first concurrent signup waits for the identity lock, then rejects the user conflict.
21. Signup-first concurrent user creation waits, then rejects the credential conflict.
22. Injected event failure rolls back the new application, credentials and session.

Machine-readable local results: `.tmp/phase1-database-verification.json`.
Initial harness fixture issues were corrected before 039 execution: PostgreSQL
inet text formatting and the existing exact volunteer PDF template requirement.
No Phase 1 application code or migration fix was needed to pass database checks.

Build, targeted lint and scoped admission/registration TypeScript checks also
passed. Existing broad-project TypeScript errors are documented in the Phase 1
implementation report and were not changed here.

Fresh regression run: **25 suites / 283 tests passed, zero failures**; 38 tests in
two separately gated integration suites remained skipped. This covers existing
regular login, registration, recovery codes and manager provisioning, alongside
the separate 22 real-PostgreSQL checks above. Results are saved in
`.tmp/phase1-deployment-regression-results.json`.

Read-only DEV HTTP checks after stopping rollout: root returned HTTP 200 with
`{"ok":true}`; unauthenticated `/auth/me` returned the expected HTTP 401.
These checks verify the existing deployment; no new deployment was performed.

## Backup blocker and required continuation

Backup preparation authenticated to DEV with existing server credentials, verified
TLS and created a directory with inheritance disabled and ACLs limited to the
current Windows user and SYSTEM. It began a repeatable-read, read-only transaction
and attempted to inventory the relevant application data before `pg_dump`.
Inventory failed with PostgreSQL `42501` at `registration_draft_deletions`.
The transaction was rolled back and the connection closed.

Subsequent read-only privilege checks confirmed SELECT on the other 13 inventoried
tables but **no SELECT on `registration_draft_deletions`**. Snapshot export itself
is permitted and succeeds. Migration 038 deliberately grants this table no direct
runtime access; that protection should remain intact.

Before resuming rollout, obtain a complete owner-authorized DEV backup through
an approved privileged backup channel that includes the protected deletion audit
and relevant public/private schema definitions, verify archive integrity and
record the data inventory. Do not grant broad runtime privileges or silently omit
the protected table. Then recheck DEV identities, migration prerequisites and data
freshness, apply 039 atomically, verify existing data, set schema readiness true
with password authentication explicitly false, and only then commit/push dev and
deploy the Server DEV service. Those hosted steps were not executed in this run.
