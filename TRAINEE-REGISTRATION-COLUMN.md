# Desktop trainee table — parent registration status

Added the **טופס** column to the existing desktop חניכים table, preserving its MUI chips, table styling, RTL layout, search, active/archive filters and client pagination.

The column reuses the existing registration status codes and Hebrew label mapping: מאושר, ממתין לאישור, הוחזר לתיקון and טיוטה. A null current status displays אין טופס. When the registration feature is unavailable/disabled, the column displays an em dash rather than incorrectly claiming no form exists.

## Data and authorization

The existing `GET /user/get-all-trainees` response is enriched for authorized administrators with `parentRegistrationStatus`. No separate browser request is made per trainee. One bounded PostgreSQL metadata query handles the complete already-filtered list (up to the existing 500-row limit), including its current branch IDs. It selects no medical contents, signatures or form data. Non-admin callers retain their prior response and receive no registration status metadata.

Status selection lives in the existing registration repository. It reuses `ACTIVE_STATUSES`, selects a current draft/review/correction before a prior approval, and excludes forms from another primary branch. Approved forms/applications count only within an active activity year's date window. An older individual approval does not incorrectly satisfy an open yearly-registration requirement; yearly approvals and approved current-year applicant registrations follow the existing annual-registration rules. An existing active request remains visible, matching the backend's active-request behavior.

The existing pagination and search operate on enriched rows. Registration mutations invalidate both the registration and trainee-list caches, so returning after approval/corrections refreshes the column. The shared correction label now consistently reads הוחזר לתיקון.

An approved chip is a keyboard-accessible action that opens the latest verified approved PDF in a new browser tab. The same batch query returns only opaque form/document UUIDs and the source type; it does not expose a Storage path or private content. The new same-origin viewer then calls the existing authenticated renewal or application document API. Those services re-read the form/application and enforce the existing branch-manager permission before downloading from private Storage. Non-approved states and approved rows without a verified PDF remain non-clickable.

## Verification

- Server and Client builds passed.
- Server regression run: **49 suites / 350 tests passed**, including the 500-row single-query test, permission/disabled-feature tests and existing registration/authentication tests.
- A read-only PostgreSQL check exercised **11 synthetic CTE cases** using the actual batch query, covering all statuses, active-vs-approved precedence, expired approvals, wrong-branch data, applicant approvals and individual/yearly validity. It created no tables or records and executed one status query. Repeat with `node scripts/check-trainee-registration-status.cjs` after a Server build.
- Client: scoped ESLint, **18 model tests** and production demo-exclusion check passed. Existing bundle-size warning remains unchanged.
- Real authenticated manager browser: the new column displayed the recovered submission as מאושר and other rows as אין טופס. Search narrowed the existing 46-trainee list to the approved trainee while preserving its status; active/archive filtering retained the column without errors. Existing pagination controls/counts remained intact. The existing narrow-screen RTL horizontal scroll was visually inspected.
- Clicking the approved chip opened a separate `/registration-pdf` tab, the authenticated document request returned HTTP 200, and the viewer rendered the real three-page Hebrew PDF in its embedded browser PDF viewer. The browser exposed the rendered child as a `blob:` document while the parent tab retained the same-origin authenticated route.
- No N+1 API pattern was added; list authorization and filtering remain on their original route. No migration, index, database fixture, Production change, commit, push or deployment was performed for the column.

## Changed files

Server:

```text
src/modules/parent-registration/registration.repository.ts
src/modules/user/user.controller.ts
src/modules/user/user.repository.ts
src/modules/user/user.service.ts
src/modules/user/user.registration-summary.spec.ts
scripts/check-trainee-registration-status.cjs
```

Client:

```text
src/interfaces/user.interface.ts
src/features/parent-registration/api.ts
src/features/parent-registration/hooks.ts
src/features/parent-registration/ApprovedRegistrationPdfPage.tsx
src/pages/DesktopPages/TraineePage/Trainee.constants.ts
src/pages/DesktopPages/TraineePage/TraineePage.tsx
src/router/Router.tsx
```

The local Server was rebuilt/restarted to load the enriched list route; the running Vite Client picked up the UI changes. Local services remain available for review. See `REGISTRATION-PDF-RECOVERY.md` for the preceding PDF fix and actual saved-submission recovery.
