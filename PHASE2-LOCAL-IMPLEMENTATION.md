# Phase 2 — unified entry and applicant registration UI (local DEV preparation)

Date: 2026-11-09, Asia/Jerusalem.

Implemented in isolated, uncommitted worktrees based on the latest remote DEV:

- Client: `../EtLaasot-Client`, base `345e6d32580b82dd9bcebd53d213087a0c5be9b1`.
- Server: this worktree, base `036d2dd4f5fec227c5932375ccae13493f2af1e1`.

No commit, push, merge, deployment, Railway variable change, database mutation,
migration execution or application deletion was performed. Original worktrees,
Production/main, Documents and branding configuration were preserved.

## Result and API contracts

The Client uses the existing DEV legacy branding and existing form components.
`VITE_APPLICANT_PASSWORD_AUTH_ENABLED` is false when unset. The new UI also
requires the existing applicant and ID-first flags, a validated local/DEV API
target, and legacy branding. Production targets cannot activate this UI.
Server behavior remains gated by the existing `APPLICANT_PASSWORD_AUTH_ENABLED`
and the Phase 1 verified DEV/schema prerequisites. No deployed flag was enabled.

The new Client opts into `POST /auth/identify` with:

```json
{ "identifier": "<national ID>", "flow": "PASSWORD" }
```

Only a next-step enum is returned:

- `PASSWORD`: regular account login, including inactive/archived identities,
  using the existing AuthContext and regular `/auth/login` API.
- `REGISTER`: email/password/confirmation, plus trainee/volunteer selection.
- `APPLICANT_PASSWORD`: password access through the Phase 1 applicant API.
- `LEGACY_RECOVERY`: explicit continuation of an old code-based application.

Without `flow`, the old identification contract remains unchanged, even when
the server feature is available. Rate limits and minimum identification latency
remain in the existing controller/guard. No profile, application ID, status,
email, branch or role is exposed by this discovery response.

Signup and password login reuse Phase 1 `/parent-applications/password/signup`
and `/parent-applications/password/login`. Applicant fallback tokens stay in
memory across the login/apply navigation; the HttpOnly applicant cookie remains
the reload mechanism. No regular-user JWT is created or attached to applicant
requests. No credentials or personal application cache are stored in localStorage.
Stale 401 responses cannot clear a newer fallback token. Session expiry clears
the scoped applicant cache and returns to sign-in without clearing regular auth.

The new workspace resumes the saved `currentStep`, supports corrections and
shows pending/rejected/approved states. Pending and rejected requests have no
editable form. Approved requests direct the person to regular account login;
an applicant session is never upgraded to regular permissions.

No email verification, recovery code generation/acknowledgment, temporary password
or email-reset API is part of the new entry. Legacy code recovery is available
explicitly at `/apply?legacy=1`; in the enabled UI that page is recovery-only.
With the new flag false, the original registration UI remains intact.

## Branch selection and integrity

Branch selection appears in the personal-details stage of both existing forms.
The new workspace passes active branch options; the legacy form callers do not,
so they retain their original layout and request bodies.

The existing draft PATCH now accepts optional `branchId: string | null`. Branch
and content are saved together under the application's row lock and one revision
increment. The common autosave queue coalesces edits and branch changes without
using a separate out-of-order request. No artificial branch is assigned.

The Server rejects unknown/inactive branches, stale revisions, and branch changes
after submission. Branchless drafts may be saved; signing and submission require
an active branch. Manager scoping continues to use the persisted application
branch; branchless drafts do not acquire a manager's branch permissions.

Signed evidence is not bound to a branch in the legacy content-hash contract.
Therefore Phase 2 deliberately locks branch reassignment once any signature
evidence exists, rather than allowing old signed evidence to be reused in a new
branch. The UI also locks the selector after a persisted signature or submission.
Changing a not-yet-signed draft branch clears any local signature input; immutable
evidence/history are never deleted or rewritten. A future controlled transfer of
a signed application needs a separately reviewed workflow.

No database schema change or new migration is needed; this uses Migration 039.

## Verification

- Server: 26 suites, **301 passed**, 38 preexisting isolated-DB tests skipped.
  Includes 18 new routing/branch tests plus existing auth, recovery, approval,
  evidence, password and applicant-isolation regressions.
- New UI: **16 Playwright tests passed** with mocked API only: trainee and
  volunteer signup, password login, all application statuses, autosave/resume,
  branch validation, expired session during editing, visibility/confirmation,
  regular-account navigation, legacy recovery and 320px RTL layout.
- Disabled UI: **16 existing Playwright tests passed**, including legacy codes,
  both volunteer/trainee forms, signing, review and mandatory password change.
- Client model tests: **19 passed**.
- Client build, full and registration TypeScript checks, lint and production
  artifact exclusion checks passed. The local QA page is excluded from dist.
- Server build, scoped admission TypeScript check and lint for the new spec passed.
- No Phase 2 tests connected to a hosted database or live backend. The existing
  PostgreSQL tests that require migrations were not executed in this phase.

Local browser fixtures use the installed Chrome executable. The QA Vite config
loads no dotenv and uses loopback port 5194, without replacing existing servers.
Screenshots contain synthetic data only:

- `../EtLaasot-Client/.registration-qa/password/signup-mobile.png`
- `../EtLaasot-Client/.registration-qa/password/signup-desktop.png`
- `../EtLaasot-Client/.registration-qa/password/trainee-personal-mobile.png`
- `../EtLaasot-Client/.registration-qa/password/volunteer-personal-mobile.png`

Reproduce with `npm run test:password:ui`; on this machine set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to the installed Chrome path. The separate
`playwright.password-legacy.config.ts` runs the legacy suite with the new flag off.

## Files changed

Server:

- `src/modules/parent-admission/admission.controller.ts`: identification opt-in.
- `src/modules/parent-admission/admission.dto.ts`: validated optional flow/branch.
- `src/modules/parent-admission/admission.repository.ts`: minimal identity lookups.
- `src/modules/parent-admission/admission.service.ts`: next-step routing and safe branch changes.
- `src/modules/parent-admission/application-flow.spec.ts`: new offline contracts.
- This report.

Client:

- `src/features/parent-admission/UnifiedEntry.tsx`: ID, password and signup screens.
- `src/features/parent-admission/PasswordApplicantPage.tsx`: isolated workspace/status routing.
- `src/features/parent-admission/password-flow.ts`: disabled-by-default DEV UI gate and memory-only client.
- `src/features/parent-admission/BranchSelection.tsx`: shared accessible branch field.
- `src/features/parent-admission/TwoStepLogin.tsx`, `ApplicantPage.tsx`: gated composition with legacy fallback.
- `src/features/parent-admission/api.ts`: Phase 1 methods, applicant transport and nullable branch support.
- `src/features/parent-registration/api.ts`, `useDraft.ts`: revision-safe optional branch autosave.
- `src/features/parent-registration/RegistrationMobile.tsx`, `Stages.tsx`: personal-stage branch and locked applicant ID.
- `src/features/volunteer-registration/VolunteerRegistration.tsx`: personal-stage branch.
- `tests/password-ui/flow.spec.ts`: mocked browser coverage.
- `password-demo.html`, `vite.password.config.ts`, `playwright.password.config.ts`,
  `playwright.password-legacy.config.ts`: isolated local previews/tests.
- `package.json`, `tsconfig.registration.json`, `scripts/check-registration-build.mjs`:
  commands, typechecking and exclusion of the QA page from shipped artifacts.

## Dependencies before safe DEV activation

Do not activate either deployed password-flow flag yet.

1. Implement the approval transaction that provisions the user with the existing
   applicant hash, `mustChangePassword=false`, no temporary password, and no setup
   email requiring another password. Preserve the old approval path for legacy
   applications and manually provisioned users.
2. Complete the transition to account-owned credentials: link the approved user,
   revoke applicant sessions and reset links as appropriate, and verify regular
   login with the exact originally chosen password, including approval/login races.
3. Define independently verified ownership recovery. The unverified family email
   is not identity proof and must not authorize an automatic reset or legacy claim.
4. Test the full lifecycle with a local real database under separate migration/
   fixture authorization, including signed evidence and approval-time concurrency.
5. Review both diffs and coordinate Client/Server DEV release flags only after
   explicit commit/deployment/activation approval. No legacy draft cleanup is included.

Residual product/security tradeoff: ID-first discovery reveals the next route
and therefore some identity-existence information. This phase limits the response
to that enum, retains rate limiting, and does not disclose personal data or grant
access without a password or legacy recovery proof. Complete prevention would
require a different discovery UX or additional identity verification.
