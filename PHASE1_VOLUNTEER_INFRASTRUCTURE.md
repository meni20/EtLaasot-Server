# Volunteer registration infrastructure — Phase 1

Implemented locally on `dev`. No commit, push, deployment, remote migration,
production access, real applicant data, or real account creation was performed.
Existing uncommitted workspace changes were preserved. Documents was unchanged.

## Behavior

- Existing `/parent-applications` endpoints remain. Omitted registration types
  default to `TRAINEE`; invalid types are rejected. Application identity remains
  unique across types. Branch authorization remains in the existing service.
- Shared policies select draft/submission validation, declarations/template
  versions, evidence kinds and operation availability. The trainee policy uses
  the original validators and declarations. The volunteer policy is deliberately
  unavailable for every lifecycle operation, including start and approval.
- Generic form-data contracts reserve volunteer data without inventing form or
  legal fields. Runtime trainee decoding is guarded by the application policy.
- `createUserWithRole(input, transaction?)` uses the caller's transaction for
  uniqueness lookup, user insertion and role/branch assignment. Without a caller
  transaction it retains its original managed transaction behavior. Temporary
  passwords, hashes, expiry and mandatory first-login password change are reused.
- The applicant entry selector is opt-in, physically left in RTL, and retains ID
  and branch while changing selection. Volunteer selection displays an unavailable
  message and disables creation. The trainee form is unchanged. Applicant query
  keys include registration type and application ID; the trainee adapter rejects
  volunteer snapshots. Authentication and recovery protocols were not changed.

## Migration and flags

`migrations/033_application_registration_types.sql` requires migrations 030–032.
It adds `registration_type` with `TRAINEE` defaults to applications, versions and
evidence; type-consistent foreign keys; a queue index and supporting FK indexes;
type-specific declaration/evidence/MIME constraints; and nullable signature-purpose
metadata for future volunteer agreements, parental consent and confidentiality.
Police clearance is reserved as PDF evidence only; its actual applicability and
upload workflow remain unimplemented. Existing immutable triggers, server ACLs,
RLS policies, national-ID uniqueness, payloads and signature references remain.

The migration was applied only to newly created loopback-only test clusters with
synthetic fixtures. It has **not** been applied to the application DEV database,
Railway or Supabase. Apply it to an explicitly selected DEV database before
running this updated admission model against that database. Do not enable DB sync.

- Client: `VITE_VOLUNTEER_REGISTRATION_ENABLED=false` (default).
- Server: `VOLUNTEER_REGISTRATION_ENABLED=false` (default).
- Setting either flag to true does not enable volunteer application creation,
  submission, uploads, PDF generation or approval in this phase.
- Existing trainee admission/registration flags remain necessary and unchanged.

## Files changed for this phase

Server:

- `.env.example`
- `migrations/033_application_registration_types.sql` (new)
- `src/modules/parent-admission/admission.policy.ts` (new)
- `src/modules/parent-admission/admission.policy.spec.ts` (new)
- `src/modules/parent-admission/admission.controller.ts`
- `src/modules/parent-admission/admission.dto.ts`
- `src/modules/parent-admission/admission.entities.ts`
- `src/modules/parent-admission/admission.repository.ts`
- `src/modules/parent-admission/admission.service.ts`
- `src/modules/parent-admission/admission.spec.ts`
- `src/modules/parent-admission/admission.http.spec.ts`
- `src/modules/user/user.service.ts`
- `src/modules/user/user.admission-provisioning.spec.ts`
- `scripts/test-parent-admission-db.cjs` (include migration prerequisites through 033)
- `scripts/test-volunteer-infrastructure-local.cjs` (new)
- `PHASE1_VOLUNTEER_INFRASTRUCTURE.md` (this report)

Client:

- `.env.example`
- `src/features/parent-admission/registration-type.ts` (new)
- `src/features/parent-admission/ApplicantPage.tsx`
- `src/features/parent-admission/api.ts`
- `src/features/parent-registration/api.ts` (optional query scope only)
- `src/features/parent-registration/hooks.ts`
- `tests/phase4.model.test.ts`
- `tests/phase4-ui/admission.spec.ts`
- `vite.phase4.config.ts` (isolated test-only flag override)

The working-tree diff also contains changes that predate this phase. They are
not included in the list above and were not reverted or claimed as Phase 1 work.

## Validation

Before implementation: Server admission 48/48; registration 82/82; Client model
tests 18/18; admission browser tests 6/6; registration browser tests 14/14.

After implementation:

- Server admission: 62/62; registration: 82/82.
- Server admission/registration type checks and Nest build pass.
- Client model tests: 19/19; full and registration type checks and Vite build pass.
- Admission browser tests: 7/7 with preparation off, 7/7 with it on.
- Trainee registration browser tests: 14/14.
- Targeted Client ESLint and Git whitespace checks pass.
- Fresh local PostgreSQL 17 checks pass: legacy defaults; preserved immutable
  payloads/signatures; type FKs; cross-type national-ID uniqueness; declaration
  counts; evidence MIME/purpose rules; RLS/ACLs; repository type/branch isolation;
  real role-failure rollback; caller-transaction rollback; standalone provisioning.

Browser tests use installed Chrome because the bundled Playwright browser is
missing. Test harnesses block non-loopback requests and mock application APIs.
The database runner creates a new cluster without loading `.env`, verifies its
data directory, uses synthetic fixtures, and stops it in cleanup. Stopped cluster
files are retained in ignored `.tmp/volunteer-phase1-*` directories.

Useful commands (from the corresponding repository):

```powershell
# Server — offline unit tests and isolated fresh local PostgreSQL integration
npm run test:parent-admission
npm run test:parent-registration
npm run typecheck:parent-admission
npm run typecheck:parent-registration
npm run build
node scripts/test-volunteer-infrastructure-local.cjs

# Client
npm run test:phase4
npm run test:registration
npm run typecheck
npm run typecheck:registration
npm run build
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='C:/Program Files/Google/Chrome/Application/chrome.exe'
npm run test:phase4:ui
npm run test:registration:ui
$env:PHASE1_UI_VOLUNTEER_PREPARATION='true'
npm run test:phase4:ui
```

## Remaining work / Phase 2 entry point

The authoritative volunteer PDF remains missing from this workspace. It is needed
before defining exact questionnaire fields, legal text, age/parental rules,
clearance applicability and signing scopes. OTP/contact verification, new recovery,
volunteer form stages, actual signatures/uploads, PDFs, manager review changes,
submission and activation remain out of scope and unimplemented.

Phase 2 can build on the shared policy/type contracts, additive schema, isolated
query scopes and transaction-aware provisioning without creating another system.
Client build still reports the existing bundle-size warning; it does not fail.
