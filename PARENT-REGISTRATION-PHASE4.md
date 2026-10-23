# Phase 4 — local implementation and approval boundary

Implemented locally on `feature/parent-registration-phase4`, based on Server `dc907ec2ee1428906384c50adb94e907841ee410`. Client uses its own branch with the same name, based on unpushed `58c73d1507cb7d8e936b73e7b9ada4558f1655c3`. Existing Phase 2/3 feature branches and both local `dev` references are preserved. No Phase 4 commit, push, merge, database migration, database connection, Railway operation or Storage operation was performed.

## Existing prerequisites inspected

Phase 2/3 source, authentication/password/session code, branch and role conventions, the local migration sequence through 030, and the verified DEV migration evidence in `.tmp/parent-registration-dev-deployment-20261021/migration-verification.json` were inspected. That evidence records application history count 32 and Supabase version `20261021160737`, with 030 applied once. **030 is unchanged and was not rerun.** No fresh cloud database query was needed for this local task.

Actual DEV uses UUID users, varchar(50) branch identities, varchar(255) role IDs, integer `user_roles.roleId` without the synthetic role FK, non-owner `etlaasot_app`, Supabase default ACLs and RLS. These differences are retained in the migration/security design. The future synthetic test harness adjusts the fixture text before execution to use the audited role-ID convention; it is not a copy of cloud data or a production schema compatibility certification.

## Architecture and trust

`ParentAdmissionModule` is loaded only when ID-first login or independent applications are enabled. It has a separate public guard, shared PostgreSQL abuse counters, applicant credential scope, application repository, immutable versions/events/evidence, and branch-authorized administrator controllers. It never treats an applicant token as the existing application's JWT or creates an active user during drafting/submission.

`POST /auth/identify` performs an indexed, keyed national-ID lookup and returns only `next: PASSWORD | REGISTER`. Existing and archived identities use PASSWORD. With applicant registration disabled, unknown identities also use PASSWORD. Password continuation still calls unchanged `POST /auth/login` / `AuthService.login`, preserving verification, reCAPTCHA checks, lockout, roles, JWT/cookies, session restoration and mandatory password change. Existing password administration remains unchanged; no email/SMS prerequisite or new automatic password email was added.

The product-required next-step distinction necessarily reveals one bit of account existence. It is **not** claimed to eliminate enumeration. Mitigations are shared atomic global/peer/identity budgets, normalized keyed identity counters, uniform minimal response fields, a 250–300 ms minimum initiation service time, no user search, and no anonymous account/contact/medical data. Repeated invalid inputs also consume global/peer limits.

Public counters use a dedicated pepper and retain no plaintext IP/ID/token. Limits are per action over ten-minute windows: global 600 and socket-peer 30; identity 8 where applicable. Autosave/session traffic uses global 6000 and peer 300. Counters are database-backed across replicas; this is not an in-memory limiter. Untrusted forwarded IP headers are ignored. Behind an unconfigured proxy the budget is conservatively shared by socket peer. Review trusted proxy topology/NAT capacity before enabling a cloud public flow; no proxy configuration is changed here. Expired keys are reused, but retired hash keys require an approved operator retention/cleanup policy; no scheduled deletion job is installed.

Public mutations require a configured trusted Origin or an explicit applicant-session header, and hostile Origins are rejected even when a token header exists. The route guard caps JSON at 96 KiB; Express also retains its existing JSON parser limit. There is no binary upload parser here. Responses use private/no-store and public applicant responses also set no-referrer. New public paths are redacted in slow-request logs, including query strings. No request bodies, raw credentials, passwords, national IDs, medical data or signature payloads are logged by the new code. New SQL logging is disabled; startup rejects unsafe sync/logging flags.

## Applicant credentials and lifecycle

1. Start with a valid national ID and server-listed active branch. The branch is checked and locked in the transaction. Existing user identities, including soft-deleted identities, cannot create a parallel application. A database UNIQUE identity constraint prevents concurrent duplicates.
2. Store the lookup HMAC and versioned encrypted ID using existing identity utilities and unchanged keys. National IDs inside draft/version JSON use the existing encryption mechanism. Other protected form data follows Phase 2's private database access model.
3. Issue distinct cryptographically random 256-bit session and recovery credentials. Persist only domain-separated HMAC-SHA256 hashes. Session expiry is 24 hours; recovery has a fixed maximum 90-day lifetime from creation.
4. Session cookie is HttpOnly, scoped to `/parent-applications`, with existing secure cross-site cookie policy. A returned session token supports a memory-only custom-header fallback when cookies are unavailable. It is never put in a URL or browser persistent storage.
5. Show the recovery credential once for an explicit private download. The user must acknowledge saving it before continuing. It contains no national ID. A valid recovery code atomically rotates both credentials and invalidates old copies without extending the absolute recovery deadline. A national ID alone cannot recover/read a draft. There is no automatic ID-only lost-code fallback. Lost/revoked recovery requires a separately reviewed manual identity-verification process; no administrator credential-reset shortcut is exposed.
6. Drafts are revision-controlled, identity and branch remain fixed, content edits invalidate both signatures, and submitted/terminal states are not editable. A single active credential pair scopes all public draft/status operations to its own application; public routes do not accept an application ID.
7. Submission requires all ten exact declarations, a valid first-parent signer ID/signature, optional independently valid second-parent signing, an owned verified medical summary and current private signature evidence. Evidence IDs cannot be reused across parents or reused as signatures on corrected submissions. Idempotency is bound to the submitted revision.
8. Submission creates an immutable version and PENDING_REVIEW state. Corrections preserve the signed version, clear signatures from a new draft, increment revision and expose only the authorized applicant's feedback. Rejection is terminal; no account is created and no automatic duplicate reapplication overwrites the original request.
9. Administrator review enforces the application's branch on every list/detail/review/approval operation. Signed content is read-only. Approval requires a current reviewed version, explicit manual identity-verification confirmation, current signed PDF and medical/signature evidence reverified through the evidence adapter.
10. Approval locks the application row and calls the existing `UserService.createTraineeWithRole` with the same outer transaction. The existing password generator, Argon2 hashing, temporary-password expiry, active trainee role and mandatory password change are reused. Account/role/application/audit writes commit together or fail together. Uniqueness constraints protect concurrent account creation. A concurrent second approval cannot issue another password.
11. The temporary password returns once only to the authorized administrator for manual delivery, under no-store. It is not persisted in the application, event trail or Client query cache. If a committed response is lost, use the existing authorized password-reset process; replay does not reveal the old password.
12. The initial approval records its current activity-year identity. A newly approved applicant satisfies that year's annual requirement in the same branch, without copying or fabricating a Phase 2 PDF record. A different year or an explicit blocking individual renewal still requires approval. The schema-ready capability flag keeps these checks valid even if new application intake is later disabled.

## API routes and DTOs

All new DTOs use strict whitelist/validation through the existing global ValidationPipe. Unknown properties are rejected; boolean consent is not coerced from strings. UUID path parameters are v4.

| Method/path | Trust | Input / result |
| --- | --- | --- |
| POST `/auth/identify` | Public, rate/Origin controls, login flag | `{ identifier }` → `{ next }` |
| POST `/auth/login` | Existing unchanged authentication | Existing identifier/password/reCAPTCHA contract |
| GET `/parent-applications/branches` | Public, applicant flag/rate controls | Only active `{ id, name, city }` |
| POST `/parent-applications/start` | Public, applicant flag/rate/Origin controls | `{ identifier, branchId }` → new application, credential cookie, memory token and one-time recovery code |
| POST `/parent-applications/recover` | Recovery credential | `{ recoveryCode }` → rotated credentials; never ID-based access |
| GET `/parent-applications/me` | Applicant session only | Own application summary/draft/declarations/integration state |
| PATCH `/parent-applications/me/draft` | Applicant session + revision | `{ revision, currentStep:1..5, data }` |
| POST `/parent-applications/me/submit` | Applicant session + evidence | `{ revision, idempotencyKey }`; disabled by unavailable integration |
| POST `/parent-applications/session/revoke` | Applicant session | Revoke session and recovery pair; clear cookie |
| GET `/parent-applications/me/attachment-capabilities` | Applicant session | Explicit unavailable capabilities |
| POST `/parent-applications/me/attachments` | Applicant session | Always 503 while private upload integration is unavailable; no fabricated path/verification accepted |
| GET `/parent-applications/admin` | Existing admin JWT + branch scope | `{ branchId?, page? }`; 25 summaries/page |
| GET `/parent-applications/admin/:id` | Existing branch-authorized admin JWT | Immutable submitted versions and private evidence metadata, no storage URLs |
| POST `.../:id/request-changes` | Same admin scope | `{ reason }` |
| POST `.../:id/reject` | Same admin scope | `{ reason }` |
| POST `.../:id/approve` | Same admin scope + evidence | `{ expectedVersionId, identityVerified:true }`; never an applicant token |

## Immediate annual and individual restrictions

The existing `JwtAuthGuard` now calls `RegistrationRequestAccess` after successful password/JWT/session authentication and mandatory-password-change checks. When blocking is enabled it checks the current database requirement on **each protected trainee request**, without caching the annual decision in a JWT. Opening an annual period therefore affects already-authenticated trainees on subsequent API requests with no grace period. The primary branch comes from the database, not a client-selected branch. Approved current-year applications and approved annual forms satisfy the annual requirement. Individual requests block only when their server-owned `blocksAccess` value is true.

Volunteers and administrators are exempt, including mixed-role accounts. Explicit server-owned essential endpoint metadata allows authentication restoration/password change, own profile read, registration operations and activity-year access. General profile writes and normal trainee operations are not exempt. Login/logout remain possible. Failure to verify restriction status fails closed. A missing enabled enforcement provider also fails closed.

Client listens for the server's `PARENT_REGISTRATION_REQUIRED` 403 without clearing the authenticated session. Restricted navigation permits only the existing registration page and logout, replacing old bookmarks with the registration route. Status is rechecked every 15 seconds or explicitly; Server enforcement does not wait for that poll. Mandatory password change retains priority. Normal access resumes after a successful approval/status check; failed status checks do not restore access. No PWA API/medical caching is added.

## Migration order and flags — do not apply yet

`030_parent_registration.sql` is already applied on DEV. **Only new `031_parent_applications.sql` would be pending for DEV after separate approval.** It creates six new tables: trainee_applications, applicant_sessions, trainee_application_versions, trainee_application_evidence, trainee_application_events and registration_public_limits. It adds foreign keys/indexes/uniqueness/checks, enables RLS, explicitly removes inherited PUBLIC/client/service-role ACLs, and grants only required server operations. Immutable records have SELECT/INSERT only and reuse 030's invoker immutability trigger. It does not alter existing user/medical tables, create roles, touch Storage, seed data or change keys.

| Server flag | Default / prerequisite |
| --- | --- |
| `ID_FIRST_LOGIN_ENABLED` | false; independently enable initiation |
| `APPLICANT_REGISTRATION_ENABLED` | false; independently enable public intake/recovery/admin application routes |
| `PARENT_REGISTRATION_ENABLED` | false; existing authenticated renewal module |
| `PARENT_REGISTRATION_BLOCKING_ENABLED` | false; requires the authenticated module; never enabled on running environments here |
| `PARENT_ADMISSION_SCHEMA_READY` | false; operator capability marker only after separately approved 031 verification; required for either new admission flag and preserves current-year approved-application recognition when intake is off |
| `PARENT_REGISTRATION_TOKEN_PEPPER` | separate fresh 64-hex secret; required only for admission; never reuse or rotate existing encryption/hash keys |
| `DB_SYNC`, `DB_LOGGING` | must remain false when feature modules are enabled |

Client opt-ins: `VITE_ID_FIRST_LOGIN_ENABLED`, `VITE_APPLICANT_REGISTRATION_ENABLED`, `VITE_PARENT_REGISTRATION_ENABLED`, `VITE_PARENT_REGISTRATION_BLOCKING_ENABLED`, all false unless explicitly set to `true`. It also requires matching explicit approved registration/application API URLs and the existing DEV environment opt-in. No real `.env` file or Railway variable was edited. Coordinate a future rollout only after migration/evidence dependencies and approval; flags are not permission to migrate or deploy.

## Storage/PDF boundary — full approval is intentionally unavailable

`UnavailableAdmissionEvidence` is the only installed adapter and always fails verification/generation. The Client clearly marks upload, real submission and approval unavailable. There is no live upload/storage client, queue worker, object insertion, mock document reference, fake READY transition or public document URL. Even plausible DB evidence references cannot pass the default adapter. Pure tests inject a fictional adapter only to exercise transaction logic.

The future adapter must authenticate every upload/download with the existing session/branch authorization, use a separately approved private bucket and server-generated paths, enforce bounded bytes/sniffed PDF/PNG formats and malware policy, verify bucket privacy and checksums, bind assets to the application/current signed content, and never accept caller-supplied verification/ownership. PDF work must load a committed immutable version, fetch verified signatures, call Documents privately using its internal key, validate returned PDF bytes and persist verified evidence before READY. Durable dispatch/retry and private authorized evidence viewing are still required. No bypass or real submit/approve enable switch exists in this implementation.

The existing Documents schema was inspected read-only. Its endpoint is `/internal/documents/render`, with its existing internal authentication and `application/pdf` response. It expects `template:parent-registration`, `version:v1`, `declarationVersion:v1` and a strict DTO. Phase 2's declaration fingerprint/template identifiers must be explicitly verified and mapped, not blindly forwarded. There are unresolved domain mappings: parent1/parent2 do not imply father/mother; free-text developmental data cannot safely invent structured disability/attention enums; toileting cannot be guessed to mean mobility; the UI currently selects PDF/PNG/JPEG while the prepared evidence contract requires a PDF medical summary. These require a reviewed mapping/conversion or field extension before connecting Documents. **Documents is unchanged and no renderer was called.**

## Offline tests and safe local testing

Run without starting the application or loading its database environment:

```powershell
npm run build
npm run typecheck:parent-registration
npm run typecheck:parent-admission
npm test -- --runInBand
node --test scripts/parent-registration-attestation.test.cjs
npm run test:parent-admission:db
```

The last command has **plan-only** behavior by default: it opens no connection and runs no SQL. Local Client unit/browser instructions are in its Phase 4 report. Test mail/push log lines in the existing regression suite come from mocks; no actual communication was sent.

### Proposed isolated PostgreSQL test plan — separate approval required

No sandbox, database, role, credential, migration or fixture was created/modified for Phase 4. Seven real PostgreSQL integration tests are prepared but **not executed**: concurrent approval, approval rollback, credential rotation/revocation, concurrent duplicate intake, shared parallel rate limits, non-owner RLS/immutable ACLs, and immediate annual plus individual renewal enforcement.

After explicit approval only:

1. Reattest the existing dedicated PostgreSQL 17 sandbox at exactly `127.0.0.1:55439`: OS listener/process/executable/data-directory/cluster identifier/manifest and authenticated nonce/role/database identity. Never use 5432/5433, `.local-postgres`, cloud or application connections.
2. Provision a **fresh empty** `etlaasot_parent_registration_test_phase4_<suffix>` database and sandbox-only non-owner `etlaasot_app` role/membership for the existing dedicated test runner, if absent, using separately approved sandbox administrator credentials. Do not recreate or reset any existing test database. The runner does not provision roles, databases or clusters.
3. Supply the dedicated connection URL and sandbox nonce through a secure process environment, never chat, logs or committed files. The URL must use `etlaasot_test_runner` on the approved loopback port. The new database must have the sandbox nonce configuration needed by the existing attestation.
4. Set `PHASE4_TEST_APPROVED=fresh-isolated-phase4-only`, `PHASE4_TEST_DATABASE_URL` and `PHASE4_TEST_NONCE` only in that approved local test process, then execute:

   ```powershell
   npm run test:parent-admission:db -- --execute
   ```

5. The runner independently attests every pg/ORM connection before schema/application SQL, refuses a populated database, and creates only a synthetic prerequisite fixture plus 030 once in that **new test database**, followed by 031 and a test nonce marker. This is not rerunning 030 on DEV or an existing test database. The seven prepared tests use fictional data, real transactions and a test-only evidence adapter; they do not test real Storage/PDF integration. Ephemeral test secrets are generated in memory, and child processes receive no cloud/app environment credentials. Any failed attestation aborts immediately.
6. Preserve the test database/cluster for review; there is no automatic drop, reset, destructive rollback or cleanup. Actual PostgreSQL syntax/transaction/RLS behavior remains unverified until this approved test is run. Removing the new test database later requires explicit approval and renewed sandbox identity checks.

Do not use `npm run migrate`, run AppModule against a stale `.env`, start the main server against DEV/Production, or replay historical migrations as a shortcut.

## Review and remaining work

See `PARENT-REGISTRATION-PHASE4-RESULTS.md` for actual check results and the full changed/new file inventory. The implementation is ready for review and the proposed isolated schema test, not for an enabled end-to-end cloud rollout. Missing private upload/PDF processing and real PostgreSQL integration verification remain explicit blockers. Existing keys, cloud records, main/Production branches, Documents and Storage are untouched by this Phase 4 work.
