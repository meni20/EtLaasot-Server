# Phase 5 — complete working-tree review inventory

Full local DEV follow-up (2026-10-22): added `PARENT-REGISTRATION-LOCAL-DEV.md` and `src/modules/auth/auth.service.local-dev.spec.ts`; updated the launcher, authentication service, registration integration/service/tests and admission service/tests to remove fictional-branch runtime restrictions. DEV attestation and normal authorization remain. See the current local DEV report for the exact file list.

Startup follow-up additions (2026-10-22): Server `scripts/phase5-startup.cjs`, `scripts/phase5-startup.test.cjs`, `PARENT-REGISTRATION-PHASE5-STARTUP.md`; Documents `src/startup-error.ts`, `test/startup-error.test.ts`. The existing launcher, Documents `src/main.ts`, main report and this inventory were also updated. The original inventory below remains a snapshot of Phase 5 completion.

Generated 2026-10-22. Paths are relative to each repository. `M` means a tracked modification; `??` means an untracked/new file relative to HEAD. Preserved Phase 4 files are included. Ignored local secrets, PDFs, screenshots, node_modules and build outputs are excluded. No files have been staged or committed.

Phase 5-specific additions include migration 032; the six phase5 scripts; registration-integration service/module/spec and typed render adapter; Client vite.phase5.config.ts; Documents registration-integration tests; and this report/inventory. Other Phase 5 changes extend existing files, including previously untracked Phase 4 modules. Consult the main report for responsibilities.

## EtLaasot-Server

Branch: `feature/parent-registration-phase5`. HEAD: `dc907ec2ee1428906384c50adb94e907841ee410`. Files: 53.

```text
 M package.json
 M src/app.module.ts
 M src/main.ts
 M src/modules/auth/auth.controller.ts
 M src/modules/auth/auth.service.ts
 M src/modules/auth/authorization.module.ts
 M src/modules/auth/guards/jwt-auth.guard.ts
 M src/modules/parent-registration/parent-registration.module.ts
 M src/modules/parent-registration/registration-document.generator.ts
 M src/modules/parent-registration/registration.controller.ts
 M src/modules/parent-registration/registration.dto.ts
 M src/modules/parent-registration/registration.repository.ts
 M src/modules/parent-registration/registration.service.ts
 M src/modules/parent-registration/registration.validation.ts
 M src/modules/user/user.controller.ts
 M src/modules/user/user.repository.ts
 M src/modules/user/user.service.ts
?? PARENT-REGISTRATION-PHASE4-DEV-DATABASE.md
?? PARENT-REGISTRATION-PHASE4-RESULTS.md
?? PARENT-REGISTRATION-PHASE4.md
?? PARENT-REGISTRATION-PHASE5.md
?? migrations/031_parent_applications.sql
?? migrations/032_registration_medical_image_mime.sql
?? scripts/phase5-browser.cjs
?? scripts/phase5-final-browser.cjs
?? scripts/phase5-fixtures.cjs
?? scripts/phase5-local.cjs
?? scripts/phase5-renewal-browser.cjs
?? scripts/phase5-security-browser.cjs
?? scripts/test-parent-admission-db.cjs
?? src/modules/auth/guards/jwt-registration.spec.ts
?? src/modules/parent-admission/admission.controller.ts
?? src/modules/parent-admission/admission.dto.ts
?? src/modules/parent-admission/admission.entities.ts
?? src/modules/parent-admission/admission.evidence.ts
?? src/modules/parent-admission/admission.http.spec.ts
?? src/modules/parent-admission/admission.migration.spec.ts
?? src/modules/parent-admission/admission.module.ts
?? src/modules/parent-admission/admission.repository.ts
?? src/modules/parent-admission/admission.security.ts
?? src/modules/parent-admission/admission.service.ts
?? src/modules/parent-admission/admission.spec.ts
?? src/modules/parent-registration/registration-integration.module.ts
?? src/modules/parent-registration/registration-integration.service.ts
?? src/modules/parent-registration/registration-integration.spec.ts
?? src/modules/parent-registration/registration-render.contract.ts
?? src/modules/parent-registration/registration-request-access.spec.ts
?? src/modules/parent-registration/registration-request-access.ts
?? src/modules/user/user.admission-provisioning.spec.ts
?? test/parent-admission/jest-db.json
?? test/parent-admission/lifecycle.db-spec.ts
?? test/parent-admission/tsconfig.json
?? PARENT-REGISTRATION-PHASE5-FILES.md
```

## EtLaasot-Client

Branch: `feature/parent-registration-phase5`. HEAD: `58c73d1507cb7d8e936b73e7b9ada4558f1655c3`. Files: 29.

```text
 M package.json
 M scripts/check-registration-build.mjs
 M src/components/SideMenu/SideMenu.constants.tsx
 M src/config/axiosInstance.ts
 M src/config/tokenStore.ts
 M src/constants/route.constants.tsx
 M src/features/parent-registration/RegistrationAdmin.tsx
 M src/features/parent-registration/RegistrationMobile.tsx
 M src/features/parent-registration/Stages.tsx
 M src/features/parent-registration/api.ts
 M src/features/parent-registration/model.ts
 M src/features/parent-registration/useDraft.ts
 M src/pages/Mobile/LoginPage/Login.tsx
 M src/router/Router.tsx
 M tsconfig.registration.json
?? PARENT-REGISTRATION-PHASE4.md
?? phase4-demo.html
?? playwright.phase4.config.ts
?? src/features/parent-admission/ApplicantAdminPage.tsx
?? src/features/parent-admission/ApplicantPage.tsx
?? src/features/parent-admission/RegistrationBoundary.tsx
?? src/features/parent-admission/TwoStepLogin.tsx
?? src/features/parent-admission/api.ts
?? src/features/parent-admission/demo/main.tsx
?? src/features/parent-admission/navigation.ts
?? tests/phase4-ui/admission.spec.ts
?? tests/phase4.model.test.ts
?? vite.phase4.config.ts
?? vite.phase5.config.ts
```

## EtLaasot-Documents

Branch: `feature/parent-registration-phase5`. HEAD: `67ce63d5153cd3f482a7f06b47d76ac4f3691b64`. Files: 8.

```text
 M src/documents/dto/render-request.dto.ts
 M src/documents/html-template.renderer.ts
 M src/main.ts
 M templates/parent-registration/v1/partials/developmental-information.hbs
 M templates/parent-registration/v1/partials/medical-information.hbs
 M templates/parent-registration/v1/partials/parent-details.hbs
 M templates/parent-registration/v1/partials/trainee-details.hbs
?? test/registration-integration.test.ts
```
