# Phase 3 — Volunteer PDF and Documents integration

Completed locally on 2026-10-25. Client, Server and Documents remain on `dev`. No commits, pushes, deployments, remote migrations, or remote data access were performed. Existing uncommitted work was preserved. Volunteer flags remain disabled by default. Approval, account activation, manager UI, OTP and recovery mechanisms were not implemented or changed.

## Mandatory personal phone

Step 1 uses the existing `Field` component with `type="tel"` and label `מספר טלפון של המתנדב`. The portable Client/Server contract validates the existing phone format, accepts incomplete legacy drafts, and requires the personal phone at submission. Drafts and immutable versions retain it; editing it invalidates covered signatures. The PDF displays it separately from both parents' numbers. `volunteerApprovedProfileMapping()` prepares `User.phoneNumber` from this field only; it is not connected to provisioning in this phase.

## Documents template

Added `volunteer-registration/v1` to the existing authenticated render endpoint, registry, validation and Handlebars/Chromium pipeline. Strict discriminated DTOs reject template/payload mismatches, unknown fields, invalid signatures, inconsistent signer identity, altered declarations, and invalid conditional data. Existing parent DTO and rendering behavior remain covered by regression tests.

All three pages of the official source were visually inspected. Source SHA256: `c33ecf62031f10052477478889e2ff3f4446b72e9842ba0abed7974226f8b607`. The versioned JSON retains the Server's source transcription exactly; a cross-repository test checks every legal field, declaration version and source checksum. No legal wording was rewritten. Layout whitespace changes, the personal phone field, document identifiers, and signature metadata are additions. Police clearance is never a render input or embedded attachment.

All original personal and questionnaire fields are mapped explicitly. Required signature PNGs, server timestamps and agreement versions are rendered. Parental consent is conditional on age at the immutable submission instant in Asia/Jerusalem, including on later retries. Bundled Hebrew/Latin fonts, escaping, isolated contexts, network restrictions, internal authentication, and bounded inputs remain in use.

## Server lifecycle and authorization

Volunteer submission commits an encrypted immutable version before PDF generation. The integration snapshots version and evidence in a short transaction, then verifies signing scopes, source declarations, checksums, private ownership, required clearance and PNG bytes. Rendering and Storage operations happen outside application row locks. A second short transaction attaches the verified PDF and records an event. Only the current pending version can become READY; historical generation does not change a newer draft's status. Submission responses refresh volunteer application state after generation.

Private PDFs record application/type/version/content hash, bucket/path, MIME, byte count, checksum, explicit template version, source checksum and generation time. Each upload is read back and verified. The existing unique PDF-per-version index plus application locking prevents duplicate document records during retries. Existing verified PDFs are reused. Failed generation records a version-scoped PDF_FAILED event and supports retry; verification failure on an existing artifact marks the current pending application FAILED. Successful verification restores READY.

`GET /parent-applications/me/pdf` uses the existing applicant credential/session authorization and resolves the latest submitted version. It streams verified private bytes with no-store/nosniff attachment headers. Existing branch-scoped administrator evidence retrieval can retrieve volunteer PDFs, including historical versions. It does not enable general volunteer review or approval. Existing retry endpoints dispatch by registration type. Existing corrections can return a volunteer application to editing; resubmission creates a new immutable version/PDF and preserves historical signed bytes. No manager UI was changed.

The volunteer completion screen displays PDF state, retry and private download controls. Existing trainee completion behavior is unchanged. No public Storage URL is issued. Existing sensitive-ID encryption and session/recovery behavior remain unchanged; error logs contain no form values or document contents.

## Additive migration

Created [035_volunteer_pdf_metadata.sql](C:/Users/User/Et-Laasot-2/EtLaasot-Server/migrations/035_volunteer_pdf_metadata.sql), after existing 033/034:

- Nullable evidence `template_version`, `source_checksum`, `generated_at`; required metadata constraint for volunteer registration PDFs.
- Nullable event `version_id` with composite application/version foreign key; PDF_GENERATED/PDF_FAILED actions and application/version index.
- Existing immutable rows, triggers, grants and RLS are retained. No Storage policies or existing signatures/evidence are rewritten.

Applied only inside fresh temporary loopback PostgreSQL test clusters. Not applied to any persistent local project database, Railway, Supabase DEV, or Production.

## Files changed by Phase 3

Paths below are absolute, grouped by repository. They describe this phase; other dirty files from prior phases or user work remain present.

Client — `C:/Users/User/Et-Laasot-2/EtLaasot-Client/`:

- `src/features/parent-admission/ApplicantPage.tsx`, `api.ts`: volunteer PDF completion/download/retry.
- `src/features/volunteer-registration/VolunteerRegistration.tsx`, `contracts.ts`: personal phone UI and shared validation.
- `tests/phase4-ui/volunteer.spec.ts`: phone input/restoration and private PDF retry/download checks.

Server — `C:/Users/User/Et-Laasot-2/EtLaasot-Server/`:

- `src/modules/parent-admission/admission.controller.ts`, `admission.service.ts`, `admission.entities.ts`: private retrieval, dispatch/lifecycle, metadata models.
- `src/modules/parent-admission/admission.policy.ts`, `admission.policy.spec.ts`: canonical template, gated PDF and corrections; approval/review remain unavailable.
- `src/modules/parent-admission/volunteer.contract.ts`, `volunteer.validation.ts`, `volunteer.spec.ts`: phone, validation, mapping and exact-source parity tests.
- New `src/modules/parent-admission/volunteer-render.contract.ts`, `volunteer-profile.mapping.ts`.
- `src/modules/parent-admission/admission.http.spec.ts`: applicant PDF credential and safe response headers.
- `src/modules/parent-registration/registration-integration.service.ts`: volunteer generation, private evidence verification and attachment lifecycle.
- New `migrations/035_volunteer_pdf_metadata.sql`.
- `scripts/test-parent-admission-db.cjs`, `volunteer-phase2-local-checks.cjs`; new `scripts/test-volunteer-pdf-local.cjs`, `volunteer-phase3-local-checks.cjs`: local migration/lifecycle coverage.
- This report.

Documents — `C:/Users/User/Et-Laasot-2/EtLaasot-Documents/`:

- `src/common/validation.pipe.ts`; `src/documents/document-generation.service.ts`, `document.controller.ts`, `template.registry.ts`, `html-template.renderer.ts`, `dto/render-request.dto.ts`: typed template dispatch.
- New `src/documents/dto/signature.schema.ts`, `volunteer-render-request.dto.ts`.
- New `templates/volunteer-registration/v1/`: `SOURCE.md`, `content.he.json`, `document.hbs`, `styles.css`; partials `personal.hbs`, `questionnaire.hbs`, `agreement.hbs`, `parental.hbs`, `confidentiality.hbs`, `signature.hbs`.
- New `mock/volunteer.scenarios.ts`, `test/volunteer.test.ts`, `test/volunteer.integration.ts`.
- `scripts/check-repository.mjs`: narrowly allowlisted new template and fictional scenario file; secret/document exclusions retained.

## Verification results

Relevant existing admission/registration and Documents tests were run before implementation to establish a baseline. Final checks:

| Check | Result |
| --- | --- |
| Server admission suite | 73 passed |
| Server trainee registration suite | 82 passed |
| Server admission typecheck and complete build | Passed |
| Fresh PostgreSQL + actual local Documents HTTP lifecycle | Passed: migrations/RLS/ACLs, immutable data, phone persistence, private evidence, concurrent retry, failure recovery, corrupted checksum, corrections/history, branch/session isolation, latest-version status, no approval/account creation by submissions |
| Existing synthetic provisioning transaction/rollback checks | Passed inside the same isolated cluster; fixture-only, no real accounts |
| Client model tests | 19 passed (11 registration + 8 admission/navigation) |
| Client browser tests, volunteer flag enabled | 11 passed; enhanced adult phone restoration/PDF retry/download scenario rerun and passed |
| Client browser tests, default flag disabled | 7 passed, 4 intentionally skipped volunteer scenarios |
| Client trainee registration browser suite | 14 passed |
| Client full build, full typecheck, registration typecheck | Passed; existing large-chunk build warning |
| Client targeted ESLint | Passed |
| Documents unit tests / build | 24 passed / passed |
| Documents actual Chromium PDF integration | 4 suites passed, covering existing trainee smoke/scenarios/typography and volunteer samples |
| Documents repository publish allowlist | Passed |
| Git whitespace checks | Passed |

Browser/PDF checks use installed local Chrome. An initial PDF run without selecting Chrome failed because bundled Playwright Chromium is unavailable; rerunning with `PDF_BROWSER_CHANNEL=chrome` passed. Client uses `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` pointing to installed Chrome. Server ESLint was attempted but its existing empty configuration ignores TypeScript files: no meaningful Server lint coverage is claimed. Documents has no lint script. The older separately-attested database runner was not executed; the self-contained fresh-cluster runner exercises the migrations and actual integration instead. No remote dependency was substituted.

Visually inspected all pages of adult (3), minor (4), and long-answer (6) generated samples, with detailed first-page inspection of long values. Hebrew text, mixed LTR values, signatures, legal sections, page breaks and margins are readable without overlap or clipping. The minor has a separate parental-consent page; the adult omits it. Automated checks cover A4 dimensions, text margins, signature image counts and browser overflow. Samples are fictional and ignored by Git:

- [Adult PDF](C:/Users/User/Et-Laasot-2/EtLaasot-Documents/output/pdf/volunteer-adult.pdf)
- [Minor PDF](C:/Users/User/Et-Laasot-2/EtLaasot-Documents/output/pdf/volunteer-minor.pdf)
- [Long-answer PDF](C:/Users/User/Et-Laasot-2/EtLaasot-Documents/output/pdf/volunteer-long.pdf)

## Remaining dependencies and Phase 4 readiness

- Actual Supabase Storage was deliberately not contacted. The end-to-end test uses the real Server verification code and an in-memory private-object adapter, real PostgreSQL, and the real Documents HTTP/Chromium service. Later DEV rollout requires explicit private-bucket/credential/allowlist attestation and the additive migration.
- Concurrent attempts or process interruption can leave unreferenced private upload objects. There is one attached immutable PDF per version; cleanup is intentionally deferred to avoid deleting an object after an ambiguous commit.
- Already-submitted Phase 2 versions without the personal phone cannot be silently amended or rendered as complete. They remain immutable and require corrections, the personal phone, renewed covered signatures, and resubmission. Existing incomplete drafts remain editable.
- Integrity failure on an immutable artifact blocks download; retry does not overwrite a corrupted referenced object. Storage restoration or a separately authorized remediation workflow is required if the original bytes cannot be restored.
- The legal source version and checksum are fixed. Future source revisions need a new versioned template and explicit compatibility policy.
- Phase 4 can build on verified immutable PDF history and the prepared personal-phone mapping for manager review and transactional approval. Review/approval/account activation remain blocked in the volunteer policy; feature flags stay false until separately authorized DEV readiness work.

Phase 3 stops here. Nothing was committed, pushed, deployed, or applied remotely.
