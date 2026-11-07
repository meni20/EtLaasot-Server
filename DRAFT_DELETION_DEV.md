# Unsubmitted draft deletion — DEV

## Scope and authorization

`POST /parent-applications/admin/:id/delete-draft` accepts only an explicit boolean `confirmed: true` and the displayed `expectedRevision`. JWT authentication and admission feature guards remain in place. The database independently requires an active, non-expired SUPER_ADMIN or the application's BRANCH_ADMIN. `GET .../:id/draft-deletion` has the same branch authorization. Eligibility is returned by the existing application detail endpoint.

Only DRAFT applications with no immutable versions, submission/review history, review fields, provisioned account, onboarding record, registration PDF or existing account identity qualify. Evidence belonging to another application or an annual renewal is protected. Submitted/version immutability remains enforced, including inconsistent parents still labeled DRAFT.

## Durable active-system erasure

1. Lock credentials, application and deletion job in the existing credential/application order. Verify authorization, eligibility and revision in one transaction.
2. Permanently remove applicant credentials and clear mutable draft personal data and the encrypted national ID. Freeze the application. The identity HMAC remains reserved until cleanup completes, preventing premature duplicate registration.
3. A worker claims one durable job with a five-minute lease. It enumerates the exact private `trainee-documents/registration/application/<UUID>/` prefix, including orphan uploads, before deleting through the Storage API. Never delete `storage.objects` rows directly.
4. Verify Storage listing is empty. The owner-only finalizer independently verifies no matching Storage metadata remains, rechecks eligibility and lease, then removes draft evidence, signatures, events and the application atomically. The national-ID unique constraint is released only by this final deletion.
5. Only COMPLETE means active database and Storage cleanup succeeded. Partial failures remain pending, blocked and retryable: up to five attempts, one minute between failures; expired leases recover. Authorized managers can restart FAILED jobs from the same screen. Repeated requests are idempotent.

Existing application/session locks serialize supported uploads and submissions with deletion. Database triggers prohibit saves, new versions, evidence and credentials after deletion starts. Runtime roles receive no general DELETE or job-table mutation privileges. Fixed SQL functions are restricted to the backend role in a private schema; the transaction-specific evidence exception is usable only by the owner finalizer, not by arbitrary DELETE or UPDATE.

Storage enumeration fails closed on traversal, unexpected depth (>4) or more than 10,000 files. A provider error, remaining object, expired lease or unexpected reference cannot produce COMPLETE. Resolve operational failures and retry; do not bypass the guards.

## Retention

Only a content-free operational audit remains: application UUID, branch ID, requesting manager ID, timestamps, completion state and retry metadata. It contains no national ID/HMAC, draft fields, signatures, evidence rows, filenames, credentials or backup payload. No cancelled application or application-level backup is created. Existing historical/provider backups are outside scope and are neither modified nor claimed erased. Submitted applications and immutable submitted evidence cannot use this deletion mechanism.

## Rollout and verification

Apply `038_unsubmitted_draft_deletion.sql` with the existing owner migration workflow **before deploying the updated model**. DEV application ledger and Supabase migration history both record the migration. No new configuration is required; the existing enabled admission/private Storage integration is reused. Production has not been migrated.

Verified in Supabase DEV `vlysppqfozfiwcmsyban` using synthetic data only:

- Actual trainee medical upload, volunteer police-clearance upload and volunteer agreement signature, plus unreferenced Storage uploads, were removed.
- All targeted application, credential, evidence, event and version row counts were zero; active Storage prefixes were empty.
- Old sessions and recovery codes were rejected. Each national ID started a new UUID with fresh credentials, and those fresh verification drafts were deleted too.
- Cross-branch and stale-revision requests were rejected without invalidating the draft's credentials.
- Five synthetic deletion jobs completed, none pending. User/role/version and non-test-branch application counts remained unchanged. No email was sent.

Focused checks: 90 admission tests, 18 request-access/provisioning tests and 17 isolated real-PostgreSQL deletion/security tests passed. Both production builds passed; Client targeted lint passed. Server ESLint has an empty configuration and does not lint TypeScript. `typecheck:parent-admission` reports the unchanged `volunteer.spec.ts:123` `idempotent` union-type assertion error; the normal Server build succeeds. No browser automation was used.

The isolated SQL suite runs `node scripts/test-welcome-db.cjs draft-deletion`, uses a fresh loopback PostgreSQL cluster and never connects to a shared database. Failure, retry, cross-branch authorization, immutable history, lease expiry, concurrent submission and duplicate workers are covered there. Offline Storage tests cover pagination, ambiguous removal/listing failures and path confinement.
