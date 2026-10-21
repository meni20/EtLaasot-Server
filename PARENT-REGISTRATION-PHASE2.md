# Parent registration Phase 2 — local review and test approval

**Current status (2026-10-20):** The user subsequently approved isolated sandbox provisioning and database tests. Migration 030 and all six integration tests have now passed. See [the isolated database test results](PARENT-REGISTRATION-DB-TEST-RESULTS.md) for retained resources, fixes, isolation evidence and frontend readiness limits. Statements below about pending database execution describe the original preparation snapshot.

Work is confined to `EtLaasot-Server`, on `feature/parent-registration-backend`, created from local `dev` at `992e10d7cbd656de6238663c024a06dc1c6fff10`. The initial working tree was clean. No existing changes were stashed, discarded, or overwritten. No commit, push, deployment, database creation, migration execution, or external-service connection was performed for this feature.

## Architecture and compatibility

- Uses existing NestJS controllers/services/repositories, the existing JWT strategy and password-change guard, `AuthorizationService`, role IDs 2/10000/10001, Sequelize transactions and PostgreSQL.
- Existing branch keys are `varchar(50)`, not UUIDs. User keys are UUIDs. New relationships use those exact types. The primary `user.branchId` determines annual-registration membership. Administrative role scoping continues to resolve `resourceId`/`branchId` through the existing authorization service.
- Six new tables: `activity_years`, `branch_registration_periods`, `registration_forms`, `registration_form_versions`, `registration_form_documents`, `registration_form_history`. No existing table is altered. Sequelize associations mirror the SQL foreign keys; SQL additionally enforces composite form/version ownership.
- One active activity year, unique branch/year periods, one simultaneous active request per trainee, and one YEARLY request per trainee/branch/year. Active means DRAFT, PENDING_REVIEW or CHANGES_REQUESTED. An INDIVIDUAL request can coexist with historical approved forms, never with another active request.
- Annual eligibility is queried dynamically from the current active year and open branch period, rather than materializing a row for every trainee. New trainees immediately qualify. The first draft is created lazily. Approval of an INDIVIDUAL request does not satisfy a still-outstanding YEARLY requirement.
- All self-service identity comes from the authenticated actor. Client-supplied trainee IDs, statuses, approval flags, document state and unknown DTO fields are rejected. Admin operations check both historical form branch and current trainee branch; transfers need explicit resolution. Active trainee/branch records and the trainee role are rechecked from PostgreSQL.
- All form writes lock the existing trainee row in a transaction, including creation when there is no form row. Admin review mutations use the same locking order. This serializes revision checks, submissions, approvals and renewals. Admin approval additionally requires the exact submitted version ID reviewed by the administrator.

## Disabled by default

`PARENT_REGISTRATION_ENABLED=false` is the default. The root module does not register the feature routes or Sequelize models when disabled. Existing login behavior is unchanged. Enabling the feature requires `DB_SYNC=false` and `DB_LOGGING=false`; startup rejects the unsafe alternatives.

`PARENT_REGISTRATION_BLOCKING_ENABLED=false` is also the default. The tested access policy is deliberately **not** attached to existing routes or registered as a global guard. Therefore even changing that flag alone cannot begin blocking existing application routes in this phase. The status response reports `wouldBlockAccess` separately. Before future activation, the server must explicitly integrate the policy after authentication and mark login/logout, password reset/change, registration, authorized uploads and support as essential flows. That integration is outside Phase 2.

Do not start the ordinary application for isolated testing: its current environment loader chooses the existing Dev or Production Supabase project by branch. The dedicated test harness bypasses it completely.

## Draft and signing contract

The five freely navigable stages are represented by `currentStep` 1–5. A draft PATCH sends `{ revision, currentStep, data }`. `data` is the **complete replacement of the current partial draft**, not a recursive merge. Omitted fields are removed. Autosave requires the latest revision and returns the incremented revision plus `contentHash`; stale requests return 409 with `DRAFT_REVISION_CONFLICT` and the current revision. Reload before resolving a conflict.

Whitelisted JSON groups are `trainee`, `parent1`, `parent2`, `contacts`, `medical`, `development`, `declarationVersion`, `declarationAcceptances`, `signatures`. The complete field schema is in `registration.validation.ts`. Drafts accept incomplete stages but enforce types, field/array limits, allowed keys, ISO dates and a 64 KiB JSON ceiling. The existing HTTP JSON parser additionally caps bodies at 100 KiB. Signature strokes, base64 images, arbitrary nested JSON and binary content have no accepted field.

Meaningful content changes always clear **both** signatures, even if a signature is supplied in the same PATCH. Save the edited content first, then save completed signatures bound to the returned hash. A signature is `{ documentId, contentHash, signedAt }`, referencing a verified, private PNG asset. Its timestamp is a client assertion, not an independent trusted timestamp. Parent 1 requires a valid national ID and signature. Parent 2 is optional; if signing, valid ID and a distinct signature asset are required. Resubmission cannot reuse signature assets from an earlier submitted version. Changing review feedback creates a draft copied from the immutable prior version with signatures removed.

National IDs in all three identity groups are encrypted inside draft/snapshot JSONB using the existing versioned AES-256-GCM national-ID utility and existing `NATIONAL_ID_ENCRYPTION_KEY`. They are decrypted only for an authorized self/admin response or validation. No new plaintext ID column, binary column, signing image, raw medical audit entry, or sensitive error log is introduced. Error responses expose safe field paths rather than field values; unexpected SQL errors are suppressed before the default HTTP exception logger.

The ten declarations were copied **exactly**, without wording changes, from the reviewed local Documents `content.he.json`. The new Server module has its own frozen versioned copy and no runtime dependency on Documents. GET me returns the approved texts/version; submission requires that version and exactly ten `true` acceptances. Each submitted version permanently stores the complete validated encrypted data, declarations, declaration/template versions, signing metadata and submission time.

Submission body: `{ formId, revision, idempotencyKey }`, with UUID v4 identifiers. The key is unique within the form. Retrying the same key/revision returns the original version; reusing it with another revision returns 409. New submissions after requested changes create the next version. Database triggers reject UPDATE/DELETE of versions, history and document metadata.

## Approval and medical mapping decisions

Approval is a single transaction: load/authorize the current form/version, require its verified private PDF and READY document state, validate the snapshot, update only mapped profile fields, mark approved and append audit history. A failure rolls back the complete transaction.

Explicit mapping requiring product review before merge:

| Registration field | Existing profile field |
| --- | --- |
| trainee.name + space + trainee.familyName | user.name; name is treated as given name in the form |
| trainee.phone | phoneNumber |
| trainee.address | address |
| trainee.dateOfBirth | dateOfBirth |
| trainee.gender | gender |
| trainee.shirtSize/customShirtSize | shirtSize/customShirtSize; custom value cleared unless OTHER |
| parent1.name | parentName |
| nonempty trainee.email | email; an empty proposed email does not clear the existing one |

The API exposes mapped before/proposed differences for the submitted version. It also provides existing allergies and medication rows for authorized review. **Allergies and medications are never automatically replaced**, even if the form says there are none. Their existing free-text/structured formats require separate medical reconciliation. Notes, national-ID identity/hash, roles, branch and other medical records are excluded from automatic synchronization. The existing age field remains untouched, consistent with existing date-of-birth profile updates.

Parent/guardian relationships, custody and legal authority are not independently verified by the backend; this phase validates recorded form/signing evidence. The exact schema and mapping choices, primary-branch rule, single active year, manual medical reconciliation, and deferred document integration should be reviewed before merging.

## Document and Storage boundary

`RegistrationDocumentGenerator` is the replacement boundary. The installed deferred adapter reports DEFERRED and makes no HTTP or Storage request. Submission is retained as PENDING_REVIEW with document state PENDING. Approval returns `REGISTRATION_PDF_PENDING` until a trusted future adapter stores a real PDF and a verified immutable reference linked to the **current** version.

The existing trainee-document upload types have no physician-summary or registration-signature type. They are not extended or repurposed. New reference records support PHYSICIAN_SUMMARY (PDF), SIGNATURE (PNG), and REGISTRATION_PDF (PDF), with private bucket/path, MIME, size, checksum and verification time. Clients cannot insert metadata or mark it verified/READY. No fake upload, document-ready, download or mock-PDF endpoint exists.

Consequently, real client submission is intentionally blocked until reviewed, verified physician-summary and completed signature assets are available through a future private-storage adapter. Admins can review structured data and safe document references now; actual attachment viewing/signed URLs is deferred with that adapter. Previous approved references remain available during renewal. No bucket is provisioned, no object uploaded, and no Supabase SDK is instantiated by this module.

The opt-in DB suite seeds **test-only reference metadata** to exercise signing/review/approval transaction logic. It does not generate a PDF, assert a real Storage upload, or enable a production bypass. Actual Documents integration and private attachment visual verification remain later acceptance work.

## API endpoints

All routes require the existing JWT guard and the enabled feature. JSON mutation by cookie also requires an allowed Origin, following the existing private-document CSRF pattern. Responses use `private, no-store`. Admin service methods enforce branch administrator or super administrator authority.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /parent-registration/me/status | Annual/current requirement and disabled blocking status |
| GET | /parent-registration/me | Draft, revision, signing hash, declarations and previous approved references |
| PATCH | /parent-registration/me/draft | Replace partial draft with optimistic concurrency |
| POST | /parent-registration/me/submit | Validate and create immutable idempotent submission |
| GET | /parent-registration/me/feedback | Review feedback and individual request reason |
| GET | /activity-years | List centrally defined years; no year-creation endpoint |
| POST | /parent-registration/admin/periods/open | Open an active year's registration for an authorized branch |
| GET | /parent-registration/admin/forms | Branch/status/year filters and bounded pagination |
| GET | /parent-registration/admin/forms/:formId | Submitted versions, profile differences and safe document references |
| POST | /parent-registration/admin/forms/:formId/approve | Transactional approval; body `{ expectedVersionId }` |
| POST | /parent-registration/admin/forms/:formId/request-changes | Return for changes; body `{ reason }` |
| POST | /parent-registration/admin/trainees/:traineeId/renew | Individual request; body `{ branchId, activityYearId, blocksAccess, reason }` |

Opening an already-open period is idempotent. Closed-period reopening, year creation, transfer/cancellation workflows, document generation callbacks, job retries and storage/view operations are deliberately not exposed without an approved design.

## Migrations: prepare only, do not run yet

1. On a future approved existing installation, retain the existing migration order through 029, including both existing 016 files. Do not renumber historical migrations.
2. Review and apply **030_parent_registration.sql** only after explicit database approval, with the schema/table owner and `public` as the intended schema. The file is forward-only and adds six tables, constraints/indexes, deny-by-default RLS/revocations and immutable-record triggers. It does not create a bucket or alter existing user/branch/medical tables.
3. This application uses its own Nest JWT, not Supabase Auth. New tables grant no anon/authenticated/service_role Data API access. Owner-level migration is required; the established owner connection can access its tables. A future dedicated non-owner application role needs an explicit reviewed least-privilege policy/grant design; no permissive RLS policy is introduced here.
4. Never use `npm run migrate` for the isolated tests; that command loads normal environment settings and traverses all historical migrations.

No SQL has been sent to any database for Phase 2. Static migration checks do not prove PostgreSQL execution correctness.

## Safe isolated test plan — awaiting user approval

The current approved work stops before database creation or migration execution. After separate approval:

1. Provision a fresh **native local PostgreSQL instance** bound to loopback on port **55439**, separate from all existing databases. Use a new local data directory and a dedicated role `etlaasot_test_runner`. The test runner does not provision the server/role/database and never drops them. PostgreSQL is a prerequisite; Docker is not required.
2. Create an empty owner database named `etlaasot_parent_registration_test_<unique_suffix>` on that instance. Use fresh fictional-test credentials; do not reuse Dev/Production keys or copy their data. Keep credentials out of command history/repository files.
3. Set `PHASE2_TEST_APPROVED=isolated-local-only` and `PHASE2_TEST_DATABASE_URL` in the executing process. The URL must target the dedicated role, exact IP `127.0.0.1`, port 55439 and the allowed database prefix, with no URL query overrides. No `DB_*`, Supabase, cloud or email settings are used. `.env` files and `runtime-environment.cjs` are never loaded.
4. Execute the following **only after approval and local provisioning**:

   ```powershell
   npm run test:parent-registration:db -- --execute
   ```

5. The runner validates the actual server IP/port/user/database, refuses any nonempty database, then transactionally installs the synthetic current prerequisite schema (`test/parent-registration/baseline.sql`) and migration 030. It writes a one-run sandbox nonce; the test process verifies that nonce and target again before Sequelize connects. No schema synchronization occurs. Provisioning errors roll back this preparation transaction.
6. The child process receives an environment allowlist and newly generated in-memory test encryption/JWT secrets. Tests mount feature controllers with the real JWT strategy/guard and database repositories, using a synthetic account lookup rather than the real login/email service. No application or cloud environment is loaded.
7. Run the six component tests covering: open annual periods including newcomers; JWT/ownership and competing revisions; concurrent idempotent submission with two signatures; SQL immutability/RLS and admin isolation; request changes and new signed version; approval blocked without PDF; transactional approval rollback/success with existing medications/allergies preserved and a subsequent nonblocking individual renewal. Some scenarios combine several checks in one test.
8. Review the retained sandbox and results. Use a **new empty sandbox** for a repeat run. Any removal of the temporary server/role/database is a separate explicitly reviewed local action. No automated cleanup can target another database.

Running `npm run test:parent-registration:db` without `--execute` prints the plan only and does not connect. This mode has been run successfully. The actual six database tests have **not** been run and no database has been created.

The synthetic baseline permits complete testing of this module against current user/branch/role/medication shapes. It is not evidence that every historical migration can rebuild the entire application from an empty database; full historical-schema replay needs a separately reviewed, data-free baseline.

## Local checks

- `npm run build`: passed (production compilation).
- `npm run typecheck:parent-registration`: passed, including the prepared database test suite.
- `npm run test:parent-registration`: **62 tests / 5 suites passed**.
- `npm test -- --runInBand`: **281 tests / 40 suites passed** in full regression verification.
- `npm run test:parent-registration:db`: plan-only passed; no connection or SQL.
- Broad `npx tsc --noEmit --incremental false`: **fails on two pre-existing unrelated test errors**, unchanged from local dev: `src/modules/trainee-document/trainee-document.repository.spec.ts:105` (count overload) and `src/modules/user/user.controller.spec.ts:2` (default import). Both existing Jest suites nevertheless pass. These errors are not hidden by the successful scoped type check.
- Database integration, SQL execution, actual Storage uploads and actual PDF generation are pending approval/future adapter work, not claimed as verified.

## Complete changed/new file inventory

The list below is generated from the final local working tree; no files are staged or committed.

Changed existing files (2):

- `package.json`
- `src/app.module.ts`

New files (25):

- `PARENT-REGISTRATION-PHASE2.md`
- `migrations/030_parent_registration.sql`
- `scripts/parent-registration-test-safety.cjs`
- `scripts/test-parent-registration-db.cjs`
- `src/modules/parent-registration/declarations.ts`
- `src/modules/parent-registration/entities/registration.entities.ts`
- `src/modules/parent-registration/parent-registration.module.ts`
- `src/modules/parent-registration/registration-access.policy.ts`
- `src/modules/parent-registration/registration-document.generator.ts`
- `src/modules/parent-registration/registration.controller.spec.ts`
- `src/modules/parent-registration/registration.controller.ts`
- `src/modules/parent-registration/registration.dto.ts`
- `src/modules/parent-registration/registration.entities.spec.ts`
- `src/modules/parent-registration/registration.guard.ts`
- `src/modules/parent-registration/registration.migration.spec.ts`
- `src/modules/parent-registration/registration.repository.ts`
- `src/modules/parent-registration/registration.service.spec.ts`
- `src/modules/parent-registration/registration.service.ts`
- `src/modules/parent-registration/registration.test-fixtures.ts`
- `src/modules/parent-registration/registration.validation.spec.ts`
- `src/modules/parent-registration/registration.validation.ts`
- `test/parent-registration/baseline.sql`
- `test/parent-registration/jest-db.json`
- `test/parent-registration/lifecycle.db-spec.ts`
- `test/parent-registration/tsconfig.json`

Documentation checked: [Supabase RLS and grants](https://supabase.com/docs/guides/database/postgres/row-level-security). New tables use RLS plus revoked client grants, consistent with the existing Nest-owned access pattern. No live project was inspected.
