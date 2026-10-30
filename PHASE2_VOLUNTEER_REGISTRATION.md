# Volunteer registration — Phase 2

Implemented only on local `dev`, preserving the pre-existing working-tree changes.
No commit, push, deployment, remote migration, live applicant data or Production
access. EtLaasot-Documents remains unchanged.

## Form and source mapping

Source: `C:/Users/User/Desktop/מני 2027/מסמכים עת לעשות/טופס רישום למתנדב לשליחה.pdf`.
All three pages were rendered and visually inspected. SHA-256:
`c33ecf62031f10052477478889e2ff3f4446b72e9842ba0abed7974226f8b607`.
`volunteer.legal.ts` contains the authoritative transcription. Only layout
whitespace was normalized. No legal wording was invented. The Client receives
these paragraphs from the existing applicant `me` endpoint. Its browser-test legal
fixture is checked against the Server source, and the portable data/scope contract
is checked byte-for-byte between repositories.

1. Personal information: first/last name, prefilled immutable national ID, birth
   date, gender, address, school, grade, email, shirt size/custom size, mother's
   name/phone, father's name/phone. The selected active branch remains on the
   application and is displayed by name in the applicant workspace. School/grade
   are required for minors and optional for adults.
2. Preferences: playroom/home mentoring/other with details; small/older trainee;
   speaking/not communicating; with/without diaper; prior instruction and special
   needs experience with conditional details; motivation. Original wording and
   choices are preserved, including the source's numbering jump from 2 to 4.
3. The complete volunteer agreement, rights and obligations, acknowledgment and
   independent volunteer signature.
4. Original parental-consent text, child's name, parent name/ID/date,
   acknowledgment and parent signature for applicants under 18. Adults see an
   explicit not-applicable state. Missing DOB does not imply adulthood.
5. Complete confidentiality agreement, acknowledgment, independent signature,
   applicable clearance upload, final validation and submission.

The source says `חובה לצרף אישור משטרה (לגברים מעל גיל 18)`. Implementation
requires it only for male applicants strictly later than their eighteenth
birthday; it is not expanded to women or minors. Parental consent is required
strictly before the eighteenth birthday. The age policy uses Asia/Jerusalem
calendar dates; a Feb 29 eighteenth anniversary in a non-leap year is March 1.
These boundary choices are explicit and can be changed if the organization adopts
an inclusive-18 or different anniversary policy. The PDF itself has no finer
boundary specification.

## Shared backend, storage and signatures

- Existing `/parent-applications` routes, sessions, recovery credentials, identity
  uniqueness, branch checks, revision controls and repositories are reused.
  Existing omitted-type requests remain `TRAINEE`.
- The volunteer policy permits applicant start/read/save/upload/submit only when
  `VOLUNTEER_REGISTRATION_ENABLED=true`. Volunteer review, approval and PDF retry
  remain unavailable. Client `VITE_VOLUNTEER_REGISTRATION_ENABLED` also defaults
  to false. The existing admission/integration flags are still required.
- Shared `useDraft` now accepts a typed field-update strategy. Its original
  trainee defaults, 650 ms debounce, serialized saves, conflict freeze, retry and
  unload warning remain intact. Shared Field/YesNo components are generic; the
  existing SignaturePad is reused. Volunteer's form uses the existing isolated
  applicant workspace; trainee adapters reject volunteer data.
- Volunteer/parent national IDs are encrypted in JSONB. Partial drafts are
  allowlisted and bounded. Final validation checks fields, conditional answers,
  actual calendar dates, national IDs, agreement versions and required evidence.
- Agreement signatures cover personal details, questionnaire and agreement
  acknowledgment. Parent signatures cover applicant identity and parent consent.
  Confidentiality signatures cover all form content, evidence references and
  earlier attestations. Changes clear only affected signatures, then renew the
  final signature when covered data or earlier attestations change.
- Signatures bind the version, signer data and purpose through a canonical SHA-256
  scope hash. The Server checks purpose, owner path, content hash, server signing
  timestamp and downloaded bytes before accepting submission. References cannot
  substitute another applicant's or another purpose's signature.
- Private applicant evidence storage is reused. PDF/PNG/JPEG clearance is limited
  to 10 MB and byte-sniffed. Signatures retain bounded PNG validation. Uploads use
  server-generated private paths, read-back checksums and no public URLs. Upload
  validation is explicitly technical, not proof of clearance authenticity.
- Submission creates an encrypted immutable application version and audit event
  with idempotency protection. Status becomes `PENDING_REVIEW`, document status
  remains `PENDING`. No volunteer account or final PDF is generated. Existing
  trainee signatures, approvals and PDF behavior remain unchanged.

## Database

Reuses Phase 1 migration 033. New migration:
`migrations/034_volunteer_clearance_images.sql` permits PNG/JPEG clearance alongside
PDF while preserving signature/generated-PDF rules. It changes no historical
rows, immutable triggers, ACLs, RLS policies or Storage settings.

Migrations were applied only to fresh loopback-only PostgreSQL test clusters with
synthetic fixtures. Neither 033 nor 034 was applied to the application's database,
Railway or Supabase. Private bucket MIME configuration was not changed or queried
remotely; an eventual authorized DEV integration must support the accepted types.

## Files changed in this phase

Server:

- `.env.example` (flag comment; default remains false)
- `src/modules/parent-admission/admission.policy.ts`
- `src/modules/parent-admission/admission.dto.ts`
- `src/modules/parent-admission/admission.entities.ts`
- `src/modules/parent-admission/admission.controller.ts`
- `src/modules/parent-admission/admission.service.ts`
- `src/modules/parent-admission/admission.policy.spec.ts`
- `src/modules/parent-admission/admission.spec.ts`
- `src/modules/parent-admission/volunteer.contract.ts` (new)
- `src/modules/parent-admission/volunteer.legal.ts` (new)
- `src/modules/parent-admission/volunteer.validation.ts` (new)
- `src/modules/parent-admission/volunteer.spec.ts` (new)
- `src/modules/parent-registration/registration-integration.service.ts`
- `migrations/034_volunteer_clearance_images.sql` (new)
- `scripts/test-parent-admission-db.cjs`
- `scripts/test-volunteer-infrastructure-local.cjs` (optional Phase 2 checks)
- `scripts/test-volunteer-registration-local.cjs` (new)
- `scripts/volunteer-phase2-local-checks.cjs` (new)
- `PHASE2_VOLUNTEER_REGISTRATION.md` (this report)

Client:

- `.env.example` (flag comment; default remains false)
- `src/features/parent-admission/registration-type.ts`
- `src/features/parent-admission/api.ts`
- `src/features/parent-admission/ApplicantPage.tsx`
- `src/features/parent-registration/Fields.tsx`
- `src/features/parent-registration/useDraft.ts`
- `src/features/volunteer-registration/contracts.ts` (new)
- `src/features/volunteer-registration/model.ts` (new)
- `src/features/volunteer-registration/VolunteerRegistration.tsx` (new)
- `tests/fixtures/volunteer-legal.json` (new)
- `tests/phase4-ui/volunteer.spec.ts` (new)
- `tests/phase4-ui/admission.spec.ts`

Other dirty files are earlier changes, including Phase 1; they were preserved.

## Validation results

Baseline before Phase 2: Server admission 62/62 and registration 82/82; Client
registration/admission model tests 19/19.

After implementation:

- Server admission/volunteer tests: 70/70. Trainee registration tests: 82/82.
- Client model tests: 19/19.
- Browser admission/volunteer suite: 11/11 with the volunteer flag enabled.
- Same suite with the flag disabled: 7/7, with four volunteer-only tests
  intentionally skipped. Those four all ran and passed in the enabled run.
- Trainee registration browser suite: 14/14.
- Client/Server builds and affected/full type checks passed. Targeted Client
  ESLint and whitespace checks passed. Vite retains its bundle-size warning.
- Mobile screenshots inspected; 320px and 390px overflow checks passed.
- A fresh local PostgreSQL run passed historical migration compatibility, RLS,
  type/branch isolation, private evidence paths/checksums, PNG clearance,
  restored drafts, stale revisions, purpose/hash binding, immutable/idempotent
  submission and no account creation by submission. The shared Phase 1 runner's
  synthetic provisioning/rollback tests also passed.

The private Storage transport in local integration tests is an in-memory double;
the application service, migrations, database and evidence validation are real.
No live Supabase connectivity or document authenticity is claimed. Browser tests
mock application APIs and abort non-loopback requests. Installed Chrome was used
because Playwright's bundled executable is absent. No selected local checks remain
blocked. Test clusters are stopped; synthetic files remain in ignored `.tmp/`.

Repeat from the relevant repository:

```powershell
# Server
npm run test:parent-admission
npm run test:parent-registration
npm run typecheck:parent-admission
npm run typecheck:parent-registration
npm run build
node scripts/test-volunteer-registration-local.cjs

# Client
npm run test:registration
npm run test:phase4
npm run typecheck
npm run typecheck:registration
npm run build
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='C:/Program Files/Google/Chrome/Application/chrome.exe'
$env:PHASE1_UI_VOLUNTEER_PREPARATION='true' # Existing isolated harness override
npm run test:phase4:ui
Remove-Item Env:PHASE1_UI_VOLUNTEER_PREPARATION
npm run test:phase4:ui
npm run test:registration:ui
```

## Phase 3 handoff

Volunteer drafts, signed immutable submissions and private evidence are ready for
manager-review/PDF integration. Manager UI, volunteer approval/activation and final
Documents rendering are deliberately unimplemented. OTP/contact verification and
new recovery remain excluded. Application-database migrations and live DEV storage
checks require a later explicitly scoped step.

The original PDF has only parents' phone fields, not an applicant phone field.
Before approval provisioning, choose an explicit contact-data policy for the
existing user's required phone number; do not silently copy a parent's number.
