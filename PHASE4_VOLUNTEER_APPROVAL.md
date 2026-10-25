# Phase 4 — Volunteer review, approval and provisioning

Completed locally on 2026-10-25. All three repositories remain on `dev`. Existing uncommitted changes from prior phases and user work were preserved. No commit, push, deployment, remote migration, Production access or remote data mutation was performed. Only synthetic accounts were created inside disposable local test clusters. Volunteer feature flags remain false by default.

## Manager UI

Extended the existing `/parent-applications-admin` screen. The volunteer flag exposes registration filters `הכול`, `חניכים`, `מתנדבים`, with a visible type chip on each application. Type, status, name search, branch and pagination are sent to the existing server endpoint and included in query keys. Changing selection, branch, filters or page clears review confirmation and temporary-password state. Authentication-session changes remount the review workspace.

Volunteer details display the immutable submitted version in read-only sections: personal details and personal phone, branch, questionnaire, signed volunteer agreement, parental consent when applicable at submission, confidentiality, clearance requirements and private evidence. Signed legal sections are sliced from the immutable declaration snapshot; managers cannot edit submitted values or declarations. The screen also displays submission time, status, decision history/reasons/version, current PDF and historical PDF downloads. Signature downloads identify their purposes. Private bytes continue through authorized endpoints; no public file URLs are created.

Approval requires identity/document confirmation and a final confirmation dialog. Rejection requires a reason and confirmation dialog. Corrections require a reason. Every decision submits the version actually reviewed. Identity confirmation is bound to the current version, so a refreshed newer version needs fresh confirmation. A conflict clears confirmation, refreshes queries and asks the manager to recheck the application. Query invalidation refreshes list and detail after decisions.

Missing/inconsistent submitted values, signatures, clearance or the current official PDF block volunteer approval in the UI. The server independently verifies all requirements. The trainee form/details and trainee provisioning path remain in use; the shared review screen gains explicit decision confirmation and version protection.

## Backend and consistency

- Existing list endpoint supports `registrationType=TRAINEE|VOLUNTEER|ALL`, status and bounded name search. Filtering happens before the existing 25-row pagination. Old list requests still default to TRAINEE. ALL and VOLUNTEER require the volunteer flag. Existing branch-manager and Super Admin scope resolution is unchanged. Search uses escaped, parameterized ORM predicates over names and does not search protected national IDs.
- Existing detail endpoint decrypts volunteer snapshots with the volunteer adapter and returns submitted evidence, declaration sections, version metadata, selected branch and immutable event history. Existing branch-scoped private downloads now permit submitted volunteer signatures and clearance as well as PDFs. Draft-only attachments remain excluded.
- Correction and rejection requests now require `expectedVersionId`, as approval already did. The service locks the application, checks pending status and the exact latest version, and appends a version-scoped event with the reason. Corrections retain immutable history and clear draft signatures before resubmission. Rejection creates no account.
- Volunteer approval uses the existing application lock and transaction. It requires pending status, READY document state, a matching immutable version/content hash, canonical template and declarations, correct identity, an active selected branch, all applicable private signature/clearance bytes, and a verified official PDF matching application/type/version/content/template/source checksum. Requirements are evaluated at immutable submission time, including parental consent and police-clearance applicability.
- The transaction calls the existing transaction-aware `UserService.createUserWithRole()`, updates the application to APPROVED with the correct `provisionedUserId`, and appends its approval audit event. Failure rolls back user, role, application update and audit together. Existing unique identity constraints remain the final concurrency guard.
- Repeated/concurrent volunteer approval of the same version returns the already-approved user association without creating another account, another approval event or another password. Stale versions fail. Inconsistent approved-user associations fail closed. Branch authorization and feature gating are checked before this replay path.

## Volunteer profile and password

Approved name, email, birth date, gender, address, shirt size and personal phone map to the existing User fields. `phoneNumber` comes only from the volunteer's mandatory phone. The existing volunteer role is ID 1 and its resource is the selected branch; the User branch is also assigned.

The existing password implementation is unchanged: an 18-character random temporary password, Argon2 hash, seven-day expiry and mandatory first-login password change. Only the first successful approval response contains the plaintext secret, under existing no-store response protections. The manager receives a masked one-time dialog with the expiry. Closing the dialog or changing application/session clears the secret. It is not placed in React Query data/mutation caches, browser storage, audit records, emails or SMS. An idempotent replay cannot recover it. A lost handoff continues to require the existing authorized reset process.

## Migration

Added [036_application_review_reasons.sql](C:/Users/User/Et-Laasot-2/EtLaasot-Server/migrations/036_application_review_reasons.sql): a nullable `reason varchar(2000)` on `trainee_application_events`, preserving correction/rejection reasons after later decisions. Version-scoped events reuse migration 035. Existing applications, versions, signatures, evidence, immutable-event triggers, grants and RLS are unchanged. No new account or approval tables are needed.

Migrations 033–036 were exercised only in a fresh loopback PostgreSQL 17 cluster created by the local runner. No migration was applied to a persistent local project database, Railway, Supabase DEV or Production. The updated application expects migration 036 before use; it writes review audit metadata through the shared repository.

## Files changed in this phase

Other dirty files shown by Git belong to prior phases or pre-existing user changes and were preserved.

Client:

- [ApplicantAdminPage.tsx](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-admission/ApplicantAdminPage.tsx): filters, typed details dispatch, decisions, version-bound verification, private downloads, history, password dialogs.
- [api.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-admission/api.ts): typed volunteer/admin responses, filter contracts and versioned decisions.
- New [VolunteerApplicationDetails.tsx](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-admission/VolunteerApplicationDetails.tsx) and [volunteer-review.model.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-admission/volunteer-review.model.ts): read-only volunteer details and approval blockers.
- New [volunteer-review.spec.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Client/tests/phase4-ui/volunteer-review.spec.ts): four local browser scenarios.

Server:

- [admission.controller.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-admission/admission.controller.ts), [admission.dto.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-admission/admission.dto.ts): filters, required decision versions, enabled approval capability.
- [admission.repository.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-admission/admission.repository.ts), [admission.entities.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-admission/admission.entities.ts): SQL filters, history and reason metadata.
- [admission.service.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-admission/admission.service.ts): volunteer review, private evidence access, atomic approval and idempotent handoff.
- [admission.policy.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-admission/admission.policy.ts), [admission.policy.spec.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-admission/admission.policy.spec.ts): independently gated review/approval.
- [volunteer-profile.mapping.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-admission/volunteer-profile.mapping.ts): typed shirt-size mapping; existing personal-phone mapping reused.
- [admission.http.spec.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-admission/admission.http.spec.ts), [admission.spec.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-admission/admission.spec.ts): filter validation, decision versions, override rejection and compatibility assertions.
- [036_application_review_reasons.sql](C:/Users/User/Et-Laasot-2/EtLaasot-Server/migrations/036_application_review_reasons.sql).
- New [test-volunteer-approval-local.cjs](C:/Users/User/Et-Laasot-2/EtLaasot-Server/scripts/test-volunteer-approval-local.cjs) and [volunteer-phase4-local-checks.cjs](C:/Users/User/Et-Laasot-2/EtLaasot-Server/scripts/volunteer-phase4-local-checks.cjs): isolated real PostgreSQL/Server/Documents lifecycle tests.
- [volunteer-phase2-local-checks.cjs](C:/Users/User/Et-Laasot-2/EtLaasot-Server/scripts/volunteer-phase2-local-checks.cjs), [volunteer-phase3-local-checks.cjs](C:/Users/User/Et-Laasot-2/EtLaasot-Server/scripts/volunteer-phase3-local-checks.cjs), [test-parent-admission-db.cjs](C:/Users/User/Et-Laasot-2/EtLaasot-Server/scripts/test-parent-admission-db.cjs): migration/version-contract compatibility in existing harnesses.
- This report. UserService, password/auth mechanisms and trainee renewal code were not changed in this phase.

Documents: no source/template/config changes in Phase 4. Existing Phase 3 uncommitted work remains intact. The existing service is exercised by the local integration test.

## Verification

Before implementation: 73 admission tests, 82 trainee registration tests and 19 Client model tests passed.

| Final check | Result |
| --- | --- |
| Server admission suite | 77 passed |
| Server trainee registration suite | 82 passed |
| Existing auth/password/JWT guard suite | 31 passed |
| Server build and admission typecheck | Passed |
| Local real PostgreSQL + real Documents HTTP integration | Passed |
| Client model tests | 19 passed |
| Client browser suite, volunteer flag enabled | 15 passed; latest conflict/confirmation/filter scenarios rerun and passed |
| Client browser suite, default flag disabled | 7 passed; 8 volunteer scenarios intentionally skipped |
| Existing trainee registration browser suite | 14 passed |
| Client complete build, complete typecheck and registration typecheck | Passed |
| Client targeted ESLint | Passed, no warnings |
| Documents existing unit tests and build | 24 passed; build passed |

The PostgreSQL test covers: migrated legacy records and ACL/RLS conventions; draft restoration and correction/resubmission history; private PDF/signature/clearance access; SQL filtering before pagination across 27 synthetic matching rows; branch and Super Admin permissions; stale decisions; rejection; inactive branch; missing signatures/clearance/PDF; corrupted bytes; PDF version/content/type/template/source mismatches; role failure and failure after application update at audit insertion; concurrent approval; exact user/role/branch/phone/profile mapping; encrypted national ID; password hash and one-time 18-character handoff. It also logs in the newly provisioned synthetic volunteer through the real AuthService, checks expiry rejection, changes the password, rejects the old password and confirms mandatory-change state clears only after the change. Existing JWT guard tests cover first-login restrictions.

No live services or real identities were used. Storage is an in-memory private-object adapter around the real verification code; PostgreSQL, Documents HTTP/Chromium and password hashing/authentication logic are real. The runner closes Documents and stops its unique cluster in `finally`.

Playwright uses installed local Chrome; bundled Playwright Chromium/agent-browser are not installed. Desktop RTL details were visually inspected from the generated [manager screenshot](C:/Users/User/Et-Laasot-2/EtLaasot-Client/.registration-qa/volunteer-manager-desktop.png). Read-only sections, legal content, private controls and filters render correctly. No passwords are in this screenshot. Existing browser tests cover trainee RTL/mobile behavior.

Server lint was attempted, but its existing empty ESLint configuration ignores TypeScript: meaningful Server lint coverage is unavailable. Documents has no lint command. The existing Client build warns about large chunks. Git whitespace checks pass. The separate legacy attested database runner was not executed; the fresh self-contained runner provides the database verification without connecting to an existing environment.

## Remaining dependencies and Phase 5 readiness

- There are no known failing Phase 4 local checks. Before any separately authorized DEV enablement, apply the additive migration through the normal process and verify actual private Supabase Storage/DEV credentials and allowlists. None were accessed or changed here.
- The review API now intentionally requires `expectedVersionId` for corrections and rejection. Older callers omitting it receive validation failure and must update with the Client; approval's existing version contract remains.
- Private evidence downloads are verified while the approval transaction holds the application lock, consistent with the existing approval architecture. Slow Storage can lengthen approval latency; PDF rendering remains outside database locks. No additional queue or provisioning service was introduced.
- Existing Phase 3 limitations remain: historical submissions missing the personal phone require correction/resubmission; corrupted immutable artifacts need authorized restoration/remediation; unreferenced private uploads from interrupted/concurrent generation need future cleanup planning.
- Losing the one-time password response does not make a second secret retrievable; use the existing authorized reset workflow. No automatic email/SMS delivery was added.
- Phase 5 can proceed from a locally verified complete review-to-account lifecycle, with explicit DEV environment verification and any further acceptance/rollout scope defined separately. Feature flags remain disabled; no remote enablement or Production work is included.

Phase 4 stops here. Nothing was committed, pushed, deployed or migrated remotely.
