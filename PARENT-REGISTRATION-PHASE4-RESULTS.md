# Phase 4 — implementation results and full review inventory

Date: 2026-10-21. **Local implementation only. No commit, push, merge, migration, database connection, cloud deployment or Storage operation was performed in this Phase 4 task.**

## Outcome and review boundary

Implemented the ID-first login opt-in, independent untrusted applicant lifecycle, secure credential-based recovery, separate branch-scoped application administration, transactional trainee/temporary-password provisioning and immediate per-request annual/individual restriction enforcement. Client reuses the existing five-stage RTL form, exact original letter/declarations and separate parent signing. Existing login remains the default when new flags are absent.

The code is ready for review and separately approved isolated PostgreSQL testing. It is **not an enabled end-to-end registration release**: private medical/signature uploads, durable PDF dispatch, strict Documents payload mapping, private evidence verification/viewing and real PostgreSQL integration validation remain outstanding. Real submission/approval cannot bypass these dependencies.

Architecture, API routes/DTOs, migration order, credential handling, all flags and the proposed safe test commands are documented in [PARENT-REGISTRATION-PHASE4.md](C:/Users/User/Et-Laasot-2/EtLaasot-Server/PARENT-REGISTRATION-PHASE4.md). Client behavior and offline preview instructions are in [PARENT-REGISTRATION-PHASE4.md](C:/Users/User/Et-Laasot-2/EtLaasot-Client/PARENT-REGISTRATION-PHASE4.md).

## Git preservation

| Repository | Working branch | Unchanged base HEAD and local dev |
| --- | --- | --- |
| Server | feature/parent-registration-phase4 | dc907ec2ee1428906384c50adb94e907841ee410 |
| Client | feature/parent-registration-phase4 | 58c73d1507cb7d8e936b73e7b9ada4558f1655c3 |

Both feature branches were created from their exact existing code states. The unpushed Client commit remains preserved on local dev and the earlier Phase 3 branch. No unrelated development work was overwritten. All Phase 4 changes remain uncommitted and unstaged.

Local main references were only read; their latest reflog entries predate this task (2026-08-23). No main/Production push, merge, checkout, migration or deployment occurred. Documents remains clean at 67ce63d5153cd3f482a7f06b47d76ac4f3691b64. No real environment file or existing encryption/hash key was changed.

## Actual checks

| Check | Result |
| --- | --- |
| Server production build | PASS |
| Server Phase 2 and Phase 4 typechecks, including prepared DB specs | PASS |
| Full Server regression suite | 46 suites / 331 tests PASS |
| Existing non-DB sandbox-attestation tests | 13 PASS |
| Client registration/application typecheck | PASS |
| Existing Client model/API/legal/environment tests | 11 PASS |
| New Client navigation/role/second-parent tests | 7 PASS |
| Existing Phase 3 Playwright suite | 14 PASS; affected admin/RTL and one/two-parent cases additionally rechecked |
| New Phase 4 Playwright suite | 5 PASS |
| Scoped Client ESLint | PASS |
| Client production build | PASS; existing large-chunk advisory remains |
| Both demo entries / mock fixture exclusion from dist | PASS |
| Git whitespace checks | PASS |
| Source secret/artifact pattern review | No findings in changed/new source; no credentials/environment/PDF/database archives included |
| Dedicated DB command without --execute | PLAN ONLY, no connection/SQL |
| Real PostgreSQL migration/integration tests | NOT RUN — seven prepared tests require separate approval |
| Real upload, PDF generation or actual account login | NOT RUN |

Browser tests used installed Chrome through Playwright on loopback-only mock harnesses. The new harness loads no environment files, real authentication provider or cloud connection. Its service-worker hook is explicitly stubbed only for QA; it does not certify a physical installed PWA upgrade. No test created actual DEV registrations or sent email/push notifications; existing test log lines refer to mocks.

Visual review covered the ID-first screen, both separate signing blocks at 320px, administrator review and restricted navigation/full letter. It caught and corrected stale Phase 3 copy that claimed blocking was disabled even when Server status said restricted. Annual-opening warnings now describe conditional immediate enforcement accurately. Mobile tests report no horizontal overflow and no runtime page errors.

## Notable hardening

- New applicant credentials are distinct random 256-bit values, stored only as domain-separated HMACs. Recovery rotates both credentials without extending the absolute 90-day deadline. ID alone cannot retrieve any saved draft, signature or medical data.
- Session cookies are HttpOnly/path-scoped; the fallback token is memory-only. Public endpoints ignore the account JWT as applicant authorization, and applicant credentials cannot authorize admin/account endpoints.
- PostgreSQL-backed rate counters are atomic across replicas, use hashed normalized identities/socket peers, ignore untrusted forwarded headers and fail closed without exposing database diagnostics. Origin and body-size controls precede application work.
- Identity uniqueness protects concurrent applications/accounts. All critical approval identity lookups, user creation, trainee-role assignment, application updates and audit writes participate in the same transaction. The existing user service accepts an optional outer transaction without changing legacy one-argument callers; no extra pool connection is required inside an approval.
- New signed versions/evidence/events are immutable. Corrections invalidate both signatures. Two signing parents require distinct normalized national IDs and separate signature assets; one parent remains sufficient.
- Approval requires explicit administrator identity verification, latest reviewed evidence and a working private evidence adapter. The only installed adapter is unavailable; no mock READY state or fabricated document reference is offered in live mode.
- Current-year approved applications satisfy annual renewal for the newly provisioned trainee in their branch. Next-year renewal and blocking individual requests still apply.
- Existing sessions are rechecked on every normal protected trainee API request when blocking is enabled. Password-change/registration essentials remain possible; admin/volunteer accounts are exempt. Status failures and missing enforcement dependencies fail closed.

## Migration and next approval

New local migration: [migrations/031_parent_applications.sql](C:/Users/User/Et-Laasot-2/EtLaasot-Server/migrations/031_parent_applications.sql). It adds six tables, explicit private RLS/grants and immutable triggers; it does not mutate existing account/medical data, create roles, touch Storage or change keys. Migration 030 is unchanged and was not rerun.

Before executing any database work, review and approve the isolated plan in the architecture document. It requires renewed OS/server/nonce/role/database attestations for exactly 127.0.0.1:55439 and a **fresh empty Phase 4 test database**, not an existing Phase 2/application database. The harness does not provision/reset/drop anything automatically. After separate approval and sandbox preparation, the exact execution command is:

```powershell
npm run test:parent-admission:db -- --execute
```

The required approval/environment guards are documented; the ordinary command without that flag is plan-only. Seven prepared PostgreSQL cases cover concurrent approval, rollback, credential rotation/revocation, duplicate intake, cross-instance rate limits, non-owner RLS/immutable permissions, and annual/individual enforcement. They have been typechecked but not executed, so actual PostgreSQL syntax and concurrency behavior are not claimed as verified.

All running environment flags were left untouched. New flags default off in source. No change was made to Supabase DEV/Production data/resources, Railway, Documents, Storage or existing keys during this task.

## Full changed/new source inventory

### EtLaasot-Server — 13 modified, 22 new

| Status | File |
| --- | --- |
| Modified | [package.json](C:/Users/User/Et-Laasot-2/EtLaasot-Server/package.json) |
| Modified | [src/app.module.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/app.module.ts) |
| Modified | [src/main.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/main.ts) |
| Modified | [src/modules/auth/auth.controller.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/auth/auth.controller.ts) |
| Modified | [src/modules/auth/authorization.module.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/auth/authorization.module.ts) |
| Modified | [src/modules/auth/guards/jwt-auth.guard.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/auth/guards/jwt-auth.guard.ts) |
| Modified | [src/modules/parent-registration/parent-registration.module.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-registration/parent-registration.module.ts) |
| Modified | [src/modules/parent-registration/registration.controller.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-registration/registration.controller.ts) |
| Modified | [src/modules/parent-registration/registration.repository.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-registration/registration.repository.ts) |
| Modified | [src/modules/parent-registration/registration.validation.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-registration/registration.validation.ts) |
| Modified | [src/modules/user/user.controller.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/user/user.controller.ts) |
| Modified | [src/modules/user/user.repository.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/user/user.repository.ts) |
| Modified | [src/modules/user/user.service.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/user/user.service.ts) |
| New | [PARENT-REGISTRATION-PHASE4-RESULTS.md](C:/Users/User/Et-Laasot-2/EtLaasot-Server/PARENT-REGISTRATION-PHASE4-RESULTS.md) |
| New | [PARENT-REGISTRATION-PHASE4.md](C:/Users/User/Et-Laasot-2/EtLaasot-Server/PARENT-REGISTRATION-PHASE4.md) |
| New | [migrations/031_parent_applications.sql](C:/Users/User/Et-Laasot-2/EtLaasot-Server/migrations/031_parent_applications.sql) |
| New | [scripts/test-parent-admission-db.cjs](C:/Users/User/Et-Laasot-2/EtLaasot-Server/scripts/test-parent-admission-db.cjs) |
| New | [src/modules/auth/guards/jwt-registration.spec.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/auth/guards/jwt-registration.spec.ts) |
| New | [src/modules/parent-admission/admission.controller.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-admission/admission.controller.ts) |
| New | [src/modules/parent-admission/admission.dto.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-admission/admission.dto.ts) |
| New | [src/modules/parent-admission/admission.entities.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-admission/admission.entities.ts) |
| New | [src/modules/parent-admission/admission.evidence.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-admission/admission.evidence.ts) |
| New | [src/modules/parent-admission/admission.http.spec.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-admission/admission.http.spec.ts) |
| New | [src/modules/parent-admission/admission.migration.spec.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-admission/admission.migration.spec.ts) |
| New | [src/modules/parent-admission/admission.module.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-admission/admission.module.ts) |
| New | [src/modules/parent-admission/admission.repository.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-admission/admission.repository.ts) |
| New | [src/modules/parent-admission/admission.security.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-admission/admission.security.ts) |
| New | [src/modules/parent-admission/admission.service.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-admission/admission.service.ts) |
| New | [src/modules/parent-admission/admission.spec.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-admission/admission.spec.ts) |
| New | [src/modules/parent-registration/registration-request-access.spec.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-registration/registration-request-access.spec.ts) |
| New | [src/modules/parent-registration/registration-request-access.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-registration/registration-request-access.ts) |
| New | [src/modules/user/user.admission-provisioning.spec.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/user/user.admission-provisioning.spec.ts) |
| New | [test/parent-admission/jest-db.json](C:/Users/User/Et-Laasot-2/EtLaasot-Server/test/parent-admission/jest-db.json) |
| New | [test/parent-admission/lifecycle.db-spec.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/test/parent-admission/lifecycle.db-spec.ts) |
| New | [test/parent-admission/tsconfig.json](C:/Users/User/Et-Laasot-2/EtLaasot-Server/test/parent-admission/tsconfig.json) |

### EtLaasot-Client — 12 modified, 13 new

| Status | File |
| --- | --- |
| Modified | [package.json](C:/Users/User/Et-Laasot-2/EtLaasot-Client/package.json) |
| Modified | [scripts/check-registration-build.mjs](C:/Users/User/Et-Laasot-2/EtLaasot-Client/scripts/check-registration-build.mjs) |
| Modified | [src/components/SideMenu/SideMenu.constants.tsx](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/components/SideMenu/SideMenu.constants.tsx) |
| Modified | [src/config/axiosInstance.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/config/axiosInstance.ts) |
| Modified | [src/constants/route.constants.tsx](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/constants/route.constants.tsx) |
| Modified | [src/features/parent-registration/RegistrationAdmin.tsx](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-registration/RegistrationAdmin.tsx) |
| Modified | [src/features/parent-registration/RegistrationMobile.tsx](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-registration/RegistrationMobile.tsx) |
| Modified | [src/features/parent-registration/api.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-registration/api.ts) |
| Modified | [src/features/parent-registration/model.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-registration/model.ts) |
| Modified | [src/pages/Mobile/LoginPage/Login.tsx](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/pages/Mobile/LoginPage/Login.tsx) |
| Modified | [src/router/Router.tsx](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/router/Router.tsx) |
| Modified | [tsconfig.registration.json](C:/Users/User/Et-Laasot-2/EtLaasot-Client/tsconfig.registration.json) |
| New | [PARENT-REGISTRATION-PHASE4.md](C:/Users/User/Et-Laasot-2/EtLaasot-Client/PARENT-REGISTRATION-PHASE4.md) |
| New | [phase4-demo.html](C:/Users/User/Et-Laasot-2/EtLaasot-Client/phase4-demo.html) |
| New | [playwright.phase4.config.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Client/playwright.phase4.config.ts) |
| New | [src/features/parent-admission/ApplicantAdminPage.tsx](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-admission/ApplicantAdminPage.tsx) |
| New | [src/features/parent-admission/ApplicantPage.tsx](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-admission/ApplicantPage.tsx) |
| New | [src/features/parent-admission/RegistrationBoundary.tsx](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-admission/RegistrationBoundary.tsx) |
| New | [src/features/parent-admission/TwoStepLogin.tsx](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-admission/TwoStepLogin.tsx) |
| New | [src/features/parent-admission/api.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-admission/api.ts) |
| New | [src/features/parent-admission/demo/main.tsx](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-admission/demo/main.tsx) |
| New | [src/features/parent-admission/navigation.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-admission/navigation.ts) |
| New | [tests/phase4-ui/admission.spec.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Client/tests/phase4-ui/admission.spec.ts) |
| New | [tests/phase4.model.test.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Client/tests/phase4.model.test.ts) |
| New | [vite.phase4.config.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Client/vite.phase4.config.ts) |

## Ignored visual QA artifacts

These contain fictional data only and are not staged/committed:

- [ID-first login](C:/Users/User/Et-Laasot-2/EtLaasot-Client/.registration-qa/phase4-login.png)
- [Signing at 320px](C:/Users/User/Et-Laasot-2/EtLaasot-Client/.registration-qa/phase4-signing-320.png)
- [Application administration](C:/Users/User/Et-Laasot-2/EtLaasot-Client/.registration-qa/phase4-admin.png)
- [Restricted navigation](C:/Users/User/Et-Laasot-2/EtLaasot-Client/.registration-qa/phase4-restricted.png)

No sample PDF was generated because this phase deliberately does not call or modify Documents.
