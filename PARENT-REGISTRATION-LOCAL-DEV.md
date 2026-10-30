# Full local development against Supabase DEV

Updated 2026-10-22 at the user's request. This supersedes the fictional-branch runtime limits described in the historical Phase 5 acceptance reports.

The local system now permits existing Supabase DEV users and branches to use normal login, password changes, registration, renewal, review, uploads, PDF generation and application/database operations according to their existing roles and branch permissions. There is no Phase 5 branch-name requirement or runtime fixture allowlist.

## Changes

- Removed `AuthService.assertLocalTestUser` and its calls before login/password changes. Correct credentials, active status, role checks, temporary-password expiry, password validation, configured reCAPTCHA and normal login-failure handling remain intact.
- Removed `RegistrationIntegrationService.assertBranch` and all calls from applicant start/session/admin operations, trainee renewals, annual periods and PDF generation/recovery. Existing branch authorization, active branch validation, ownership, immutable version/evidence checks and approval prerequisites remain intact.
- The local launcher no longer sets `PARENT_REGISTRATION_LOCAL_TEST_BRANCHES`; it removes stale copies when preparing or launching the Server. The protected config was regenerated with existing authentication/encryption keys preserved.
- The configuration's `branches` array remains fixture-script metadata only. It does not filter, authorize or restrict the application. The optional automated fixture scripts continue to use fictional records when explicitly invoked; none were run for this change.
- Added offline regression tests for ordinary-branch and global-administrator login, ordinary-user password changes and registration in an ordinary active branch. Tests also cover wrong passwords, inactive users, missing roles, expired temporary passwords and rejection of Production configuration.

Changed source/test files:

```text
scripts/phase5-local.cjs
src/modules/auth/auth.service.ts
src/modules/auth/auth.service.local-dev.spec.ts
src/modules/parent-admission/admission.service.ts
src/modules/parent-admission/admission.spec.ts
src/modules/parent-registration/registration-integration.service.ts
src/modules/parent-registration/registration-integration.spec.ts
src/modules/parent-registration/registration.service.ts
```

## Connection safeguards retained

The target is exclusively `EtLaasot-dev` (`vlysppqfozfiwcmsyban`). Preparation and every local launch verify the DEV project URL, pooler host/project role, PostgreSQL database/server identity, authorized TLS and applied migrations 030/031/032 using read-only queries. ORM connections still undergo DEV/TLS attestation before application operations. The registration integration still rejects Production/Railway execution and unexpected database identities. Automatic schema synchronization remains disabled.

The Client points to the local Server; the Server points to Supabase DEV and local Documents. The Documents API remains authenticated with the existing strong internal key. No encryption, JWT, applicant-pepper or Documents key was rotated. No deployed feature flags, Railway services, Storage settings, database records or migrations were changed by this work.

## Manual startup

The Server build was refreshed, and the protected local configuration was prepared and verified. All local services are left stopped for manual startup.

From `C:\Users\User\Et-Laasot-2\EtLaasot-Server`:

```powershell
node scripts/phase5-local.cjs prepare-local
node scripts/phase5-local.cjs verify
```

Then, in three separate VS Code terminals from that same Server directory:

```powershell
node scripts/phase5-local.cjs documents
node scripts/phase5-local.cjs server
node scripts/phase5-local.cjs client
```

Open `http://127.0.0.1:5185`. Existing accounts use their existing DEV passwords and normal role/branch scope. Login no longer rejects them merely because their branch lacks a `phase5-` prefix. Invalid credentials, inactive accounts and users without permissions continue to be rejected normally.

Verification for this change used a build, offline tests and read-only DEV attestation. No real user's password was requested or tested, and no real login, registration, renewal or database write was performed. No commits, pushes or deployments were made.

Final results: Server build passed; all **48 suites / 346 tests** passed, including the new authentication/registration regressions and existing authorization/evidence tests. All **4 launcher tests** passed. `prepare-local` and `verify` passed, and the generated configuration contains no runtime fictional-branch allowlist. The rebuilt authentication and registration modules contain no Phase 5 branch restriction. `git diff --check` passed. Final OS inspection confirmed no listeners on ports **5185, 3185 or 3285**; no services were restarted for this change.
