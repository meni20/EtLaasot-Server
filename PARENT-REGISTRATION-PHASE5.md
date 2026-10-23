# Phase 5 — local integration and acceptance

Current local behavior: [full Supabase DEV development](PARENT-REGISTRATION-LOCAL-DEV.md). At the user's request, the fictional-branch login/write limits have been removed. The acceptance results and fixture-only restrictions described below are the historical test configuration, not the current runtime policy.

Local startup follow-up: see [the reproduced port/Windows ACL failures and repair](PARENT-REGISTRATION-PHASE5-STARTUP.md). The launcher now reports safe error categories and uses the current Windows user SID for its protected configuration ACL.

Date: 2026-10-22. All three repositories use local branch `feature/parent-registration-phase5`. Existing uncommitted Phase 2–4 work was preserved. No commits, pushes, merges or deployments were performed.

## Outcome

**YES: the complete registration workflow was exercised successfully using the real local Client, Server and Documents services against Supabase DEV.** Browser tests used actual UI interaction, authenticated HTTP requests, PostgreSQL and private Storage. Responses were not mocked, evidence-ready states were not fabricated, and approval prerequisites remained enforced.

Local services: Client `http://127.0.0.1:5185`, Server `http://127.0.0.1:3185`, Documents `http://127.0.0.1:3285`. The Documents API requires its private internal key. All three bind to loopback in this test configuration.

## Implementation

### Server

- Added a typed adapter to the existing Documents v1 API, real private medical/signature uploads, server-side MIME/byte/size/hash checks, version-bound signatures and authorized private downloads. Medical files support PDF, JPEG and PNG; signatures remain PNG; generated documents remain PDF.
- Durable submission precedes PDF generation. A real renderer outage preserves the immutable submission and records failure; explicit retry is serialized and idempotent. Approval requires verified medical evidence, signatures and generated PDF. Renewal PDF failure/success is recorded in audit history with the actual actor.
- Applicant and renewal workflows retain branch authorization, correction revisions, rejection, concurrent approval protection, secure recovery and the existing temporary-password/mandatory-change implementation. Unsent draft attachments are excluded from administrator evidence lists.
- Renewal prefill can use a previously approved new application. It clears signatures and prior medical references. Profile updates occur only after approval; medical reconciliation remains the existing explicit process.
- Added local orchestration and repeatable real-browser tests. Local integration rejects Production/Railway configuration, attests the actual DEV database and TLS, restricts writes/login testing to the two fictional fixture branches, and verifies every new ORM pool connection before it can perform application work.
- Fixed real pagination-query validation and restricted-form remounting issues found by the browser tests. Redacted both registration URL families from slow-request logs.

### Client

- Connected the existing five-stage form, autosave, medical uploads, signatures, direct submission, status/corrections and administrator document review/retry to real typed APIs.
- Kept the restricted renewal form mounted while checking an already known restriction, without granting normal application access from stale checks.
- Removed bearer-token persistence in localStorage. The fallback is memory-only; existing HttpOnly-cookie authentication survives browser reload. Medical files and applicant credentials are not stored in localStorage.
- Added a dedicated local Vite configuration using the real application entry and providers. Demo/mock entry points remain excluded from the normal production build.

### Documents

- Extended the existing v1 DTO compatibly for neutral Parent 1/Parent 2 details, partial unsigned-parent information, trainee email/pants size and explicit clinical answers. Legacy father/mother requests still validate. Signed parent IDs must match the supplied parent identities.
- Unknown mobility/developmental answers render as unspecified rather than invented negative diagnoses. Developmental narrative is retained under development, not mislabeled as a mobility diagnosis.
- Updated the existing partials to retain supplied values and organize medical answers compactly without changing body font size. Each signature keeps its own ID and signing timestamp.
- The parent letter, all ten declarations, fonts and typography stylesheet are unchanged. Local development uses explicitly selected installed Chrome. Production still requires bundled Chromium. **Docker was not installed or tested locally.**

## DEV isolation and approved infrastructure change

The positively identified target was **EtLaasot-dev**, project `vlysppqfozfiwcmsyban`. Production is a different Supabase project and endpoint; no Production SQL was executed. Runtime checks include the DEV pooler/project role, actual PostgreSQL server address/port, database, role and authorized TLS connection. The application role is not the schema owner, a superuser or a BYPASSRLS role.

Migrations 030 and 031 were already applied and were **not rerun**. After the user's explicit separate approval, migration **032_registration_medical_image_mime.sql** was applied only to DEV, recorded as Supabase migration `20261022070351` (`registration_medical_image_mime_032`). It replaces two CHECK constraints to permit JPEG/PNG medical evidence alongside PDF. It changes no data rows, grants, RLS policies, triggers or Storage settings. Both constraints were verified validated; the registration/application tables retain RLS and their immutable triggers.

The existing private `trainee-documents` bucket is reused under versioned `registration/...` prefixes. No bucket, Storage policy, cloud credentials, database, role, Railway service or environment variables were created or changed. Existing encryption/hash keys and environment files were not edited. New authentication secrets are local-only, stored in an ignored directory protected with the current Windows user's ACL; they are never printed.

The existing Server root `.env` has inconsistent database/project targets and must not be used for this work. The local launcher reads `.env.development.local`, verifies the actual connection, and refuses an unexpected identity. The current Railway CLI login was expired during a read-only inspection; Railway reauthorization is needed for future deployment work, which is outside this task.

## Fictional data and preservation

Only visibly marked fixture branches `phase5-c377e809-a` and `phase5-c377e809-b` were used. The initial fixture preparation created two administrators and one existing trainee; subsequent accounts were created through genuine registration approval. A marked fictional activity year was added because no active year existed. Test registrations, immutable versions, private evidence and audit/rate-limit entries remain available.

Before testing, every existing row across all 29 public tables was fingerprinted. Read-only comparisons afterward verified that every original row was still present with identical values, including the original users, branches and medical records. New fictional rows are allowed by this comparison. Nothing was automatically reset or deleted. Test cleanup is deliberately not automatic because submitted evidence/history is immutable; a separately reviewed cleanup plan is needed if removal is desired.

## Acceptance evidence

| Required scenario | Actual result |
| --- | --- |
| New trainee → medical upload → two signatures → submission → Hebrew PDF → administrator approval → temporary-password login/change | PASS through real browser UI, local Documents and private DEV evidence |
| Existing trainee annual renewal | PASS; an already-authenticated session immediately received backend `PARENT_REGISTRATION_REQUIRED`, essential endpoints remained available, approval restored normal access |
| Individual blocking and nonblocking renewals | PASS; checked backend access before and after real approvals, preserving the original session |
| Correction request and revised submission | PASS; edits invalidated signatures, a new immutable version/PDF was created, old PDF remained, profile changed only after approval |
| One and two parents | PASS; real signature uploads, separate signer identities/dates and valid rendered PDFs |
| Private access and administrator branch isolation | PASS; anonymous Storage/application access denied, other-branch administrator denied, genuine authorized download succeeded |
| Renderer outage, retry and duplicate protection | PASS; stopped only the verified local Documents process, preserved failed submission, restarted it, retried via UI, concurrent retries/repeated submit produced one version/PDF |

Additional real checks passed: concurrent approvals produce one account and one temporary-password response; rejected applications cannot be approved; concurrent identity starts produce one application; recovery rotates credentials and revocation invalidates them; forged medical bytes are rejected; shared database rate limiting returns 429 without identifying account status; Documents rejects absent/incorrect internal keys; cookie login survives reload without localStorage bearer credentials; actual runtime RLS/immutable-table permissions remain enforced; 320px mobile layout has no horizontal overflow; PDF success/failure audit actors are correct.

### Builds and automated checks executed

- Server: `npm run build`; `npm test -- --runInBand` — **47 suites, 338 tests passed**. Subsequent focused registration checks passed after the final mapping edits.
- Client: `npm run build`, `npm run test:registration`, `npm run test:phase4`, `npm run test:registration:build` — build, 18 model tests and demo exclusion passed. Scoped ESLint passed. Existing bundle-size warning remains non-blocking. A final scan of 63 generated JavaScript assets found no configured server credentials.
- Documents: `npm run build`, `npm test` — **19 tests passed**; `$env:PDF_BROWSER_CHANNEL='chrome'; npm run test:pdf` — **3 integration tests passed**, including six real PDF scenarios, A4, all-page footers/page counters, Hebrew font/glyph checks, unchanged legal wording and intact declarations/signatures. Standard fixtures use 3 pages; long fixture uses 6.
- `git diff --check` passed in all repositories.
- Read-only DEV attestation, schema/permissions verification and original-row fingerprint verification passed.

### Repeatable actual browser commands

From the Server directory, with all three local services running:

```powershell
node scripts/phase5-browser.cjs --execute
node scripts/phase5-renewal-browser.cjs --execute
node scripts/phase5-security-browser.cjs --execute
node scripts/phase5-final-browser.cjs --execute
node scripts/phase5-fixtures.cjs --verify
```

These browser commands perform real fictional DEV writes. They do not reset tables or run migrations. The fixture creator (`node scripts/phase5-fixtures.cjs --execute`) is for first preparation only and refuses to overwrite an existing fixture manifest. Re-running acceptance adds marked fictional records; it is not a cleanup operation. The renewal script can resume verified completed stages without recreating earlier annual-period operations.

Results and screenshots are in the ignored `.tmp/phase5-local` directory: `browser-results.json`, `renewal-results.json`, `security-results.json` and `final-results.json`. The first JSON covers only its own subset and deliberately says `fullAcceptance:false`; the complete conclusion uses all four scripts together, not that subset alone.

## Startup

Build Server and Documents in their respective directories with `npm run build`. From `C:\Users\User\Et-Laasot-2\EtLaasot-Server`, prepare/verify the protected local configuration:

```powershell
node scripts/phase5-local.cjs prepare-local
node scripts/phase5-local.cjs verify
```

Then run each command in a separate terminal, all from that same Server directory:

```powershell
node scripts/phase5-local.cjs documents
node scripts/phase5-local.cjs server
node scripts/phase5-local.cjs client
```

Use `http://127.0.0.1:5185` consistently. Only the local launcher enables the new flows/blocking; deployed flags were not changed. Documents health is `/health`; the existing Server liveness endpoint is `/`, not `/health`.

## Remaining limits and review

- No remaining blocker for the exercised local DEV workflow. This is not deployment approval or evidence of production readiness.
- The historical fresh-database integration harnesses were not run against shared DEV. Their injected audit-write-failure rollback case remains unverified on real PostgreSQL (unit tests cover rollback behavior); no destructive failure injection was attempted.
- Long-term token expiry, load testing, automatic email delivery and deployed cross-site cookie/browser behavior were not exercised. Email delivery remains intentionally absent. The existing local DEV reCAPTCHA secret is absent; no security bypass flag or override was introduced.
- No Docker, Railway build/deployment or Linux bundled-Chromium execution was tested in this task. Local PDFs came from the explicitly allowed installed Windows Chrome.
- Review the complete working-tree inventory in `PARENT-REGISTRATION-PHASE5-FILES.md`. It includes preserved Phase 4 files as well as Phase 5 changes; it is not a claim that all listed files were first authored in Phase 5.
- Production, Railway, Storage configuration, encryption keys, `main` and remote branches were untouched. All work remains uncommitted on the three local feature branches.

## Final PDF artifacts and visual inspection

The final real-submission samples are [two-parent PDF](C:/Users/User/Et-Laasot-2/EtLaasot-Server/.tmp/phase5-local/new-trainee-two-parents.pdf) and [one-parent PDF](C:/Users/User/Et-Laasot-2/EtLaasot-Server/.tmp/phase5-local/final-one-parent.pdf). Both contain fictional data, are valid A4 PDFs and contain three pages. All six pages were rendered with Poppler and visually inspected after the final changes. Hebrew glyphs are naturally shaped, all ten declarations are intact, signatures remain together, IDs/dates are separate, and the footer/contact details and page numbers are present on every page. A high-resolution footer crop additionally confirmed readability. Compact medical-field grouping removed an otherwise mostly empty fourth signature page without reducing the font size or changing legal wording.

The final actual browser reruns passed after the last mapping/layout changes. The aggregate `acceptance-summary.json` records 28 passing scenario assertions across the three main browser scripts, plus the final one-parent/outage/audit/session/mobile check. Final read-only preservation verification again reported `existingRecordsUnchanged: true`, `tablesChecked: 29`. All services remained healthy on their loopback ports.
