# Phase 5 — DEV deployment and end-to-end verification

**Completed on 2026-10-25. The critical volunteer flow was verified against the live Railway DEV services and Supabase DEV, using synthetic data.** Full browser/API run completed at 19:47 UTC; the subsequent database/Storage audit passed at 19:50 UTC.

## Targets and deployment

Verified Railway project `e950a261-d932-48c2-bc19-86287cb374ef`, environment `6b2b0ac3-9131-454c-9a42-4df26937f521` (`dev`), and Supabase project `vlysppqfozfiwcmsyban` (`EtLaasot-dev`). Runtime DB identity, TLS certificate verification, disabled schema synchronization/logging, private bucket, CORS and API URL alignment passed. All three GitHub deployment triggers point to `dev` in this environment.

| Service | GitHub DEV application commit | Verified status |
| --- | --- | --- |
| Client | [19155a8](https://github.com/meni20/EtLaasot-Client/commit/19155a81f49b9daeceb37a347b07ad4f11374ac1) | SUCCESS; HTTP 200 |
| Server | [2e14e7d](https://github.com/meni20/EtLaasot-Server/commit/2e14e7dd112414e8d3a50e54bffafad5505a3fb1) | SUCCESS; HTTP 200; live application tests passed |
| Documents | [593bc7f](https://github.com/meni20/EtLaasot-Documents/commit/593bc7f2e13de4f20ab072e6a15f25ff67e0eadb) | SUCCESS; authenticated parent/adult/minor rendering passed |

An additional Server DEV operational/report commit contains this report and the guarded verification helpers; it changes no application runtime source. See [Server DEV history](https://github.com/meni20/EtLaasot-Server/commits/dev). All pushes used the explicit `dev:dev` refspec. No PR targeting Main was created.

Documents already existed in DEV. Its existing Dockerfile, bundled Chromium, Hebrew fonts, dedicated internal credentials and private Server connection were reused. It has no public domain. The Server connects to `http://etlaasot-documents.railway.internal:3000/`. Credentials were checked in memory and never printed.

## Migration and recovery point

Applied only missing migrations, in order, to Supabase DEV:

- `033_application_registration_types.sql`
- `034_volunteer_clearance_images.sql`
- `035_volunteer_pdf_metadata.sql`
- `036_application_review_reasons.sql`

Both the Supabase migration ledger and existing `public.schema_migrations` record the changes. Dependencies 030–032 were already present; their constraints matched the expected schema. No completed migration was reapplied.

Before migration, a restricted local custom-format backup of the DEV public schema/data was created and verified by decoding the complete restore stream and checking its table-of-contents. It includes 29 tables, grants, RLS definitions and the existing migration ledger. Archive SHA256: `f4e6e93e44afe608c541d2beaf911e3bd1428b6079faac8564d1276955875292`. Its private manifest path is recorded in `.tmp/volunteer-phase5-backup-manifest-path.txt`; neither backup nor data is committed.

Immediately after migration, the original 18 applications, 9 immutable versions, 33 evidence records and 42 events were preserved; all original applications defaulted to TRAINEE. Constraints were valid, RLS remained enabled, and runtime grants were unchanged. The runtime role remains neither superuser nor BYPASSRLS. The existing informational [RLS-without-policy advisory](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) was unchanged; no new security advisory was introduced.

## Feature flags

Both volunteer flags were explicitly kept false during initial deployment. After service health, CORS, private Storage read-back/anonymous-denial checks and a live authenticated trainee PDF/approval regression passed, they were enabled **only in Railway DEV**:

- Server: `VOLUNTEER_REGISTRATION_ENABLED=true`
- Client build: `VITE_VOLUNTEER_REGISTRATION_ENABLED=true`

The corresponding flag-enabled rebuilds succeeded. Committed example/default configuration remains false. Production configuration was not accessed or changed.

## Live end-to-end results

Chrome used the deployed Client and real DEV APIs. No request mocking, forged JWTs, authorization bypass, disabled RLS or reduced evidence checks were used. Two dedicated QA branches and normal branch-manager accounts were created per test run. Manager fixtures used the existing UserService/branch-role provisioning and normal login/password-change endpoints; all applicant accounts went through admission review.

| Scenario | Result |
| --- | --- |
| Unknown national ID → volunteer selector; branch and ID retained | Passed |
| Five adult form stages, mandatory personal phone, autosave and reload persistence | Passed |
| Volunteer agreement, private police test evidence, confidentiality and signatures | Passed |
| Minor form with parental consent/signature; conditional consent omitted for adult | Passed |
| Immutable submission and official volunteer PDF generation | Passed |
| Manager login, volunteer filtering, submitted details, private evidence/PDF download | Passed |
| Correction reason → applicant edits → renewed signatures → resubmission | Passed; two immutable versions and PDFs retained |
| Separate rejection | Passed; no matching user created |
| Browser approval and masked one-time password dialog | Passed; dialog secret cleared on close |
| Repeated approval | Passed; no second account, password or approval event |
| Concurrent first approval of minor application | Passed; one user ID and one password handoff |
| Volunteer role, selected branch and personal phone mapping | Passed |
| Temporary-password login and mandatory password-change route | Passed |
| Password change → volunteer mobile interface | Passed |
| Reuse of temporary password after change | Denied with 401 |
| Foreign-branch detail/PDF access and unauthenticated applicant PDF access | Denied with 403 / 401 |
| Stale approval version | Denied with 409 |
| Old request defaulting to TRAINEE, trainee evidence/PDF and manager approval | Passed live |
| Anonymous public Storage access to generated PDFs | Denied for all five audited PDFs |

The complete-run database audit found:

- Adult: APPROVED, one matching user, two submitted versions and two PDFs.
- Minor: APPROVED, one matching user, one submitted version and PDF.
- Trainee regression: APPROVED, one matching user, one submitted version and PDF.
- Rejected volunteer: REJECTED, zero matching users, one preserved version and PDF.

All five PDFs were privately downloaded and matched their stored SHA256 checksums. Volunteer template/source metadata matched `volunteer-registration/v1` and the authoritative source checksum. The private scratch Storage object used in the prerequisite upload/read-back test was removed.

Synthetic QA fixtures/audit history are intentionally retained in DEV, including the exploratory run. No existing applicant or user was edited for testing. The completed-run fixture UUIDs and results are in ignored `.tmp/phase5-e2e-results.json` and `.tmp/phase5-final-audit.json`; these files contain no passwords, tokens, national IDs or document contents. Test credentials existed only in process/browser memory and were not emailed or sent by SMS.

## Tests, fixes and operational notes

The exact staged snapshots were exported and checked before deployment, so unrelated working changes were excluded from the tested/pushed application trees:

- Server: build, 77 admission tests and 81 existing trainee registration tests passed.
- Client: build and 19 existing model tests passed. Prior Phase 4 browser/typecheck coverage remains documented separately; this phase additionally exercised the real deployed UI.
- Documents: build passed; the previously passing 24-unit/real-PDF coverage was reused, followed by actual authenticated DEV parent/adult/minor rendering.
- Final checksum/account audit and Git whitespace checks passed.

Added guarded operational helpers:

- `scripts/volunteer-dev-target.cjs`: explicit DEV IDs, repository/branch checks, TLS/database/key-reference checks; no credential output.
- `scripts/volunteer-dev-backup.cjs`: private, verified public-schema recovery archive.
- `scripts/volunteer-dev-storage-smoke.cjs --execute-dev`: private upload/read-back/anonymous-denial test with exact-path cleanup.
- `scripts/volunteer-dev-e2e.cjs --execute-dev`: explicit opt-in synthetic live browser/API verification; without the flag it performs no remote operation. It requires the existing adjacent repositories, local dependencies/Chrome and authenticated Railway CLI. It creates isolated QA fixtures and can enable the DEV volunteer flags after prerequisites.

No application code defect required a Phase 5 fix. Missing migrations and feature configuration were completed. One browser assertion was corrected to wait for the MUI password dialog's exit animation; the repeated complete run passed. A temporary Railway QA SSH key was registered while investigating private-network probe access; the workstation probe could not complete. The key was then unregistered and its task-generated files removed. Actual authenticated Server→Documents PDF generation verified the private integration instead.

Meaningful Server lint remains unavailable because the existing ESLint configuration is empty; Documents has no lint command. The existing Client large-chunk build warning remains. Safari/iOS and live Super Admin UI were not tested in this phase; the existing local authorization tests cover Super Admin behavior. None blocks the verified Chrome/branch-manager DEV flow.

Unrelated local work remains uncommitted: Client menu/login/trainee-renewal presentation and the unrelated `ListRow.pdfDocumentId` hunk; Server event-image changes and trainee-renewal repository changes/tests. No unrelated modification was pushed.

## DEV URLs

- [Start at ID-first login](https://etlaasot-client-dev-dev.up.railway.app/login)
- [Applicant registration](https://etlaasot-client-dev-dev.up.railway.app/apply)
- [Manager application review](https://etlaasot-client-dev-dev.up.railway.app/parent-applications-admin) — normal authorized DEV manager login required.
- [DEV Server](https://etlaasot-server-dev-dev.up.railway.app/)

There are no remaining critical DEV blockers. Production databases, Storage, services, credentials, Render Production and GitHub/local Main branches were not modified. No OTP, new recovery system, new form stages or password-delivery channel was introduced. Work stops at DEV.
