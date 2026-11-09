# Phase 3 — local implementation and verification

Date: 2026-11-09. Local DEV-based worktrees only; all Phase 2 work preserved.

- Server: `C:/Users/User/Et-Laasot-2/.tmp/phase2/EtLaasot-Server`, base `036d2dd4f5fec227c5932375ccae13493f2af1e1`.
- Client: `C:/Users/User/Et-Laasot-2/.tmp/phase2/EtLaasot-Client`, base `345e6d32580b82dd9bcebd53d213087a0c5be9b1`.
- Both remain uncommitted DEV-based detached worktrees. No branch switches, commits, pushes, merges, deployments, environment edits, DB connections, migrations, application deletions, Documents edits or Production actions occurred.
- Runtime flag configuration was not changed: expected DEV remains `APPLICANT_PASSWORD_AUTH_ENABLED=false`, `APPLICATION_CREDENTIALS_SCHEMA_READY=true`. Live Railway was not queried during this local-only phase. Unit tests selectively simulate enabled flags without connecting to their configured target.

## Behavior

For a server-identified credential-bearing application, approval reads the stored Argon2id hash and creates the user and trainee/volunteer role in the caller's transaction. No password generation, rehash, hash accepted from a DTO, or automatic JWT is involved. The account has `mustChangePassword=false`, no temporary password expiry, and fresh failure counters. The existing 039 trigger validates the transferred hash and serializes identity writers; account uniqueness remains enforced. Existing accounts are never updated by this creation path.

Session-before-application locking matches applicant login/recovery/save. Approval revokes password applicant sessions in the same transaction as the account, role, application state, event and welcome-outbox write. Concurrent/replayed approval checks the reviewed version and provisioned account association and does not recreate credentials, roles or mail. Trainee retries are now idempotent as volunteer retries already were. Current application state also rejects stale applicant access after approval, independently of the session revocation marker. Applicant password login already rejects provisioned accounts. Regular login is required afterward; regular JWT and role middleware are unchanged.

Legacy applications and manual user creation retain temporary passwords and the existing setup-link email process. Password applications cannot be assigned legacy recovery codes. Corrections/pending-review/rejected permissions remain available before approval; an approved application's applicant API is now denied.

Manager detail includes only the authentication mode and a masked registration-email address, never the hash. Password approval displays simple success text and existing-password instructions; the temporary-password dialog remains legacy-only. The signup login email is used for password approval notifications, independently of edited form contact data. This email remains unverified and confers no recovery or account-ownership authority. Trainee recipient confirmation and the DEV recipient allowlist remain required as before.

## Prepared migration 040

`migrations/040_approval_notification_only.sql` is PREPARED ONLY AND WAS NOT EXECUTED, including against an isolated database.

The 037 durable mail queue requires credential setup tokens for every non-skipped row. Migration 040 adds `delivery_kind` with default `PASSWORD_SETUP` and preserves the old payload constraint for old rows. It adds `APPROVAL_NOTICE` records that must contain no token hash, token ciphertext, credential fingerprint, expiration or consumption marker. It replaces only the specifically identified 037 payload check, failing closed on schema drift. No tables/rows are deleted and no existing passwords, ACLs, RLS, documents or history are rewritten. Run through the existing transactional migration runner and tracked migration history; it is not a standalone repeatable migration.

The worker supports token-free notices, ordinary login links, retry/claim leasing and the existing DEV mail allowlist. Legacy schema/worker behavior remains supported: legacy INSERTs still omit the new field, and new code detects column availability before constructing notice-aware worker/retry SQL. Older worker code cannot claim notices because it requires token ciphertext and expiry. If notice emails are enabled but 040 is absent, password approval fails closed and rolls back rather than sending a setup link. If welcome email is disabled, password approval can complete without a notice/schema 040. No email verification or automatic email password reset was added.

## Files changed in Phase 3

Server paths relative to the Server worktree:

- `src/modules/parent-admission/admission.service.ts`: approval selection, idempotency, locking, revocation, applicant status denial, recovery restrictions, safe manager metadata.
- `src/modules/parent-admission/admission.repository.ts`: internal credential lookup and session locking/revocation, with credential SQL logging disabled.
- `src/modules/user/user.service.ts`: transaction-required internal hash-transfer provisioning; legacy methods retained.
- `src/modules/user/user.repository.ts`: credential-bearing account INSERT logging disabled.
- `src/modules/parent-admission/welcome.service.ts`: token-free durable approval notices, schema-aware worker/retries and existing-password templates.
- `migrations/040_approval_notification_only.sql`: prepared schema change described above.
- `src/modules/parent-admission/approval-password.spec.ts`: transfer, original-password regular login, roles/branch, stale sessions, approval replay/races, rollback, duplicates, no temporary password/hash leakage, legacy compatibility.
- `src/modules/parent-admission/welcome-notification.spec.ts`: token-free queue/templates, delivery/retry/allowlist/legacy mail, missing-schema fail-closed behavior and migration static checks.
- `src/modules/parent-admission/admission.http.spec.ts`: reject credential/privilege injection and sanitize DB failures.
- `src/modules/parent-admission/admission.spec.ts`, `volunteer.spec.ts`: include session-locking contract in existing mocks.
- `src/modules/parent-admission/application-flow.spec.ts`: Phase 2 approved-state expectation now requires regular login; branch mutation still denied.
- `PHASE3-LOCAL-IMPLEMENTATION.md`: this handoff.

Client paths relative to the Client worktree:

- `src/features/parent-admission/ApplicantAdminPage.tsx`: mode-aware approval confirmation, mail instructions and no temporary-password dialog for password applicants.
- `src/features/parent-admission/api.ts`: optional safe authentication-mode and notification-only response metadata.
- `tests/phase4-ui/volunteer-review.spec.ts`: legacy approval coverage plus password-mode manager confirmation at 390px and 1440px, mail enabled/disabled.

All earlier Phase 2 files remain in place. The Phase 2 report is historical; this report supersedes its approval-transfer dependency.

## Verification

- Server build: passed (`npm run build`).
- Server TypeScript including admission tests: passed (`npm run typecheck:parent-admission`).
- Focused Jest: 11 suites / 189 tests passed, including Phase 2 branch safeguards, applicant signup/login/security, existing approval, auth HTTP and JWT permission isolation. No DB suites or unrelated full regression suites were run.
- Server focused lint: passed using `scripts/eslint-application-credentials.config.mjs`, retaining existing legacy `any` declarations and allowing underscore-prefixed unused variables through CLI rule overrides. New runtime paths contain no added `any` declarations.
- Client build, main TypeScript, registration TypeScript, ESLint and production-dist exclusion check: passed.
- Manager browser tests: 6 passed; real local Chrome, fully mocked APIs, all external network requests aborted. Existing legacy approval/password handoff, review/changes/rejection, immutable evidence/PDF and stale-approval handling remain covered.
- Whitespace/diff checks: passed.

Evidence screenshots (synthetic data only):

- `C:/Users/User/Et-Laasot-2/.tmp/phase2/EtLaasot-Client/.registration-qa/approval-password-390.png`
- `C:/Users/User/Et-Laasot-2/.tmp/phase2/EtLaasot-Client/.registration-qa/approval-password-1440.png`

Important verification limit: concurrency/rollback are tested using a serializing transactional contract harness, not a new PostgreSQL execution. Migration 040 has static safety tests only. In accordance with the execution boundary, no migration was run and no shared database was contacted. These tests do not replace database verification before deployment.

## Required next steps, each within separately authorized scope

1. Review Phase 2 + Phase 3 diffs together. Keep public authentication off and DEV branding legacy.
2. Obtain authorization for isolated PostgreSQL execution, then verify 039 + 040 on a representative synthetic schema: payload constraints, existing delivery preservation, application/user/role transaction rollback, concurrent approval versus login/manual user creation, application identity triggers, grants and RLS. Verify schema drift fails atomically.
3. Before any DEV mutation, verify exact Supabase DEV and Railway Server DEV identities and follow the agreed backup/rollback policy. The earlier Phase 1 backup waiver does not authorize any Phase 3 mutation.
4. After separate approval, apply 040 transactionally to Supabase DEV, preserve the two existing flag values, and commit/push/release only the reviewed DEV changes. No main/Production changes.
5. With the new public flow still disabled, verify deployed health and synthetic approval/login/mail regressions. Phase 2 includes Client changes and therefore needs a separately approved Client DEV release as well.
6. Public activation requires a later explicit approval and a complete DEV lifecycle acceptance test: signup, branch selection, autosave, signing/submission, corrections, review/approval, stale session rejection, original-password account login and role navigation. Recovery for forgotten applicant passwords still requires an independently verified ownership workflow; unverified email is not an automatic reset channel.
