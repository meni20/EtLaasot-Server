# Phase 1: applicant credentials infrastructure — DEV only

Follow-up (2026-11-09): all 22 isolated PostgreSQL checks and 283 regression tests
passed. The user explicitly waived a new DEV backup after the earlier backup
permission gate. Migration 039 is now applied to Supabase DEV; all row counts and
full-row digests in 14 existing tables remained identical. Server DEV is configured
with `APPLICATION_CREDENTIALS_SCHEMA_READY=true` and
`APPLICANT_PASSWORD_AUTH_ENABLED=false`. The new flow remains disabled. The
2026-11-08 verification report below records the earlier stopped attempt; final
deployment evidence is recorded in the local rollout report and task response.

Local implementation based on existing `dev` commit `7ff5c6d`. This worktree is
detached at that commit; no new branch, commit, push or deployment was created.
Production/main, Railway, credentials, Client, Documents and branding were not edited.
DEV remains `legacy`; Production remains `production`.

## Scope and defaults

- `APPLICANT_PASSWORD_AUTH_ENABLED=false` by default (unset is false).
- `APPLICATION_CREDENTIALS_SCHEMA_READY=false` by default; set only after migration review and approval.
- Both flags and existing `APPLICANT_REGISTRATION_ENABLED` and
  `PARENT_ADMISSION_SCHEMA_READY` are required to use the new endpoints.
- Existing volunteer availability is also enforced.
- New endpoints fail with 404 before database work if disabled or outside the
  verified DEV environment/project. Public authentication requires an allowlisted
  Origin, including when an applicant session header is supplied.
- Existing ID-first UI/identify, forms, autosave, recovery codes, regular login,
  temporary passwords, manager approval and welcome emails remain unchanged.
- No email verification, challenge table, delivery, token or reset endpoint exists
  in this feature. Mailbox possession is not treated as identity proof.

## Prepared API

`POST /parent-applications/password/signup`

```json
{
  "identifier": "123456782",
  "registrationType": "TRAINEE",
  "email": "parent@example.com",
  "password": "<chosen-password>",
  "passwordConfirmation": "<chosen-password>"
}
```

`registrationType` also accepts `VOLUNTEER`. Unknown/privileged input fields,
incorrect types, invalid identity/email, policy violations and mismatched
confirmation are rejected. Email is trimmed/lowercased, validated as an ASCII
mailbox, limited to 254 characters and deliberately nonunique. Family aliases
are preserved. Passwords use existing validation and Argon2id utilities; leading
or trailing whitespace is rejected rather than silently changing the password.

Signup atomically creates a DRAFT at step 1, separate credentials, an applicant
session and a CREATED history event. No active user/role is created. The initial
draft has no branch; branch selection and its Client/API integration are a later
phase. The form's editable contact email is not used for authentication/recovery.

`POST /parent-applications/password/login`

```json
{ "identifier": "123456782", "password": "<chosen-password>" }
```

Both endpoints return only `sessionToken` and `expiresAt`, and set the existing
`parent_applicant` HttpOnly cookie scoped to `/parent-applications`. They never
return an account JWT, password/hash, identity profile, email or recovery code.
The existing applicant `/me`, draft and evidence boundary can consume this session.
There is one active session per application; a subsequent login rotates it.

Login permits DRAFT, CHANGES_REQUESTED, PENDING_REVIEW and REJECTED workspace
access; existing application APIs still enforce which states allow editing.
It rejects provisioned/approved/deletion-pending applications and any identity
already in the regular user table. Missing credentials perform dummy Argon2
verification and use the same invalid-credentials response as a wrong password.

## Migration 039_application_credentials.sql — PREPARED, NOT EXECUTED

The repository uses its existing numbered `migrations/` and custom owner runner;
039 follows 038. It is not a Supabase CLI schema project. Do not invoke the broad
migration runner against any environment as part of local verification.

The migration adds one table: `public.application_credentials`.

| Field | Contract |
| --- | --- |
| `application_id` | UUID primary key; restrictive FK to application |
| `national_id_hash` | Unique HMAC identity; composite FK ensures it belongs to that application |
| `password_hash` | Argon2id hash; never exposed by an ORM model or API DTO |
| `login_email` | Normalized, nonunique, separate from form contact fields |
| `email_verified` | Always false in Phase 1, enforced by CHECK |
| timestamps | Creation, update and password-change times |

Primary/unique indexes support all Phase 1 lookups and FK associations. There is
no email lookup/reset API, so no email index or uniqueness requirement is added.
RLS allows only the existing server DB role. PUBLIC, anon, authenticated and
service_role get no credential-table access. No DELETE privilege is granted.
Raw SQL binds use `logging:false`; unexpected DB exceptions are sanitized.

Two compatibility relaxations preserve all existing rows:

- Applications allow a null branch only in DRAFT. Any submitted/reviewed state
  still requires a branch, and document/admin paths reject a missing branch.
- Applicant sessions allow recovery hash/expiry to be null together. Existing
  recovery values are untouched; password signup generates neither a recovery
  code nor an email token.

Database triggers and signup use the same transaction-level identity advisory
lock. Unique constraints prevent duplicate applications/credentials, while a
composite FK prevents attaching credentials to a different identity. A user
identity trigger serializes manual user creation against signup as well.
Functions use caller privileges and fixed search paths, without SECURITY DEFINER.
No user password, application data, history or Storage object is updated/backfilled.

Existing application deletion uses restrictive FKs. Credential-bearing drafts
fail closed under the old purge function; any later cleanup must explicitly
handle the credentials under separate approval.

## Transactions, retry and approval contract

Hashing runs outside locks. Signup locks the identity, rechecks both application
and user tables, and persists all records in one transaction. A conflicting retry
returns a generic 409; it never claims an old draft based on ID/email. After an
uncertain signup response, the applicant can use the password login endpoint.
Unexpected/deadlock/transaction failures return a safe 503 and roll back; there
is no automatic retry that could produce another identity or expose bound data.

Login locks session then application (matching existing recovery/save ordering),
then rechecks the hash and user association before rotating the session. It does
not take an identity lock while waiting for an application approval lock.

Phase 1 does not call or modify manager approval. Later approval must copy the
existing Argon2id hash server-to-server in the approval transaction, with
`mustChangePassword=false` and null temporary-password expiry, then link the user,
revoke applicant sessions and make the user the authoritative password source.
The migration rejects a user insert that conflicts with applicant credentials
unless it uses that exact hash, those password flags and a pending application.
Therefore the OLD temporary-password approval cannot approve a NEW
credential-bearing applicant. This is deliberate fail-closed infrastructure;
the feature MUST remain disabled until the later approval integration is ready.
All preexisting applicants without credentials continue through unchanged approval.

No automatic password reset to the unverified mailbox is implemented or allowed.
A future recovery design must establish independent account ownership; its
policy is an explicit later decision, not implicit trust in the supplied email.

## Abuse controls

The existing PostgreSQL-backed AdmissionRateLimiter is reused with separate
signup/login action scopes: 8 attempts/identity, 30/socket peer and 600/global in
10 minutes. Malformed input consumes peer/global budget before DTO validation.
Counters contain HMAC keys, not raw IDs, emails or passwords. Persistence failure
fails closed. Forwarded IPs are not trusted; proxy peer sharing follows the
existing conservative policy. No permanent account lockout is introduced.

## Local verification

Final relevant regression run: **25 suites passed, 283 tests passed, 38 tests
skipped in two isolated-DB integration suites; zero failures**. This includes
**65 new credential infrastructure tests** and existing regular login,
registration, recovery, applicant isolation and manager-provisioning checks.
Machine-readable results: `.tmp/phase1-regression-results.json` (ignored local
artifact). The initial missing-sibling-fixture and CRLF/LF parity issues were
resolved in the worktree test environment, and the full relevant run then passed.

Build, production-source TypeScript checking, the scoped admission/registration
TypeScript checks, targeted lint and formatting checks pass. The unconstrained
repository-wide `tsc --noEmit --incremental false` also runs unrelated tests and
has three preexisting errors, reproduced on the untouched original DEV checkout:
`trainee-document.repository.spec.ts:105` (Sequelize count typing),
`user.controller.spec.ts:2` (default import of a named export), and
`test/production-registration-boundary.test.ts:7` (`.ts` import option).
These unrelated files were not changed.

Commands (run from this worktree; no dotenv/cloud app startup):

```text
npm run build
node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit --incremental false
node node_modules/typescript/bin/tsc -p test/parent-admission/tsconfig.json --incremental false
node node_modules/typescript/bin/tsc -p test/parent-registration/tsconfig.json --incremental false
npm run lint:applicant-credentials
node node_modules/prettier/bin/prettier.cjs --check "src/modules/parent-admission/application-credentials*.ts" scripts/eslint-application-credentials.config.mjs
npm run test -- --runInBand src/modules/parent-admission src/modules/parent-registration src/modules/auth src/modules/user/user.admission-provisioning.spec.ts
```

The focused lint config provides actual TypeScript lint rules because the
repository-wide ESLint config is empty. Existing unrelated files are not reformatted.
Sibling Client/Documents fixtures are read through local junctions so existing
cross-repository contract tests work in the isolated worktree. The volunteer
contract parity test also requires identical checkout line endings: the isolated
Server checkout initially used CRLF while the existing Client fixture used LF.
Only checkout line endings were aligned for the tests, with identical normalized
source content; no volunteer contract implementation change is part of this patch.

Concurrency/rollback service tests use a deterministic transactional harness;
SQL contract tests inspect migration text without executing it. These do NOT
prove PostgreSQL locking, trigger execution or RLS behavior. No migration has
been executed on a local or hosted database. Actual PostgreSQL integration
verification requires separate approval before deployment.

## File inventory

New files:

- `migrations/039_application_credentials.sql`
- `src/modules/parent-admission/application-credentials.controller.ts`
- `src/modules/parent-admission/application-credentials.dto.ts`
- `src/modules/parent-admission/application-credentials.feature.ts`
- `src/modules/parent-admission/application-credentials.repository.ts`
- `src/modules/parent-admission/application-credentials.service.ts`
- `src/modules/parent-admission/application-credentials.spec.ts`
- `src/modules/parent-admission/application-credentials.http.spec.ts`
- `src/modules/parent-admission/application-credentials.migration.spec.ts`
- `scripts/eslint-application-credentials.config.mjs`
- `APPLICANT-CREDENTIALS-PHASE1.md`
- `APPLICANT-CREDENTIALS-DEV-CLEANUP-REPORT.md`

Existing files changed:

- `package.json`: focused test/lint scripts; no dependency changes.
- `admission.module.ts`: register credential controller, guard and services.
- `admission.entities.ts`: model nullable branch and optional recovery columns.
- `admission.repository.ts`: missing branch lookup fails closed.
- `admission.service.ts`: guard branchless admin access and null recovery expiry.
- `registration-integration.service.ts`: reject document generation without a branch.

All abbreviated TypeScript paths above are under `src/modules/parent-admission/`,
except `registration-integration.service.ts` under `src/modules/parent-registration/`.

## Required steps before DEV deployment

1. Review the diff and migration; keep both new flags false/unset.
2. Separately approve migration execution in an isolated test database. Verify
   the real PostgreSQL behavior: parallel signup; signup versus manual user
   creation in both orders; cross-identity FK rejection; transaction rollback;
   anon/authenticated/service_role denial; server access; nullable recovery;
   preservation of existing accounts, recovery and legacy approval.
3. Approve DEV migration/deployment explicitly. Re-attest DEV project, server
   role and TLS settings, review migration history, and apply only reviewed
   pending DEV migrations using the repository owner workflow. Verify table ACLs,
   triggers/constraints and the before/after legacy data inventory.
4. Set schema readiness only after verification. Deploy the reviewed backend
   with `APPLICANT_PASSWORD_AUTH_ENABLED=false`; confirm new endpoints return 404
   and existing login, forms, recovery, approval and branding still behave as before.
5. Keep activation for a later phase: finish branch selection UI/API and approval
   transfer, decide secure ownership recovery for unverified email, and obtain
   explicit activation approval. A code deployment is not permission to activate.

No commit, push, merge, Railway configuration update or deployment is authorized
by this local implementation. Rollback of the disabled backend leaves the added
schema/data in place; never delete applicant credentials to roll code back.
