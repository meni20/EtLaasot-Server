# Phase 5 local startup repair — 2026-10-22

Current local access policy: [all DEV users and branches with standard permissions](PARENT-REGISTRATION-LOCAL-DEV.md). The later change removes fictional-branch runtime limits while preserving the startup repair and DEV isolation checks documented here.

Two distinct failures were reproduced and resolved.

## Root causes

1. **Documents listen failure:** `127.0.0.1:3285` was already occupied by an earlier Documents child process from `phase5-local.cjs documents`. Starting a second copy produced the actual OS error `EADDRINUSE`. The Documents catch block hid it behind the generic startup message. Rebuilding could not free an occupied socket. The old Server and Client were also still running on their assigned local ports.
2. **Intermittent preparation failure:** `save()` obtained a localized account name with `whoami` and decoded its output as UTF-8. In a nested Windows process, the Hebrew computer name was instead emitted in the OEM code page. The corrupted name passed to `icacls` could not be mapped to a Windows identity (exit 1332). Writing the JSON itself succeeded, so the protected configuration could still be read and the database-only `verify` action could pass. This explains why preparation and verification appeared inconsistent.

The OEM/UTF-8 mismatch and ACL error were reproduced directly. Preparation could succeed from one shell and fail from a nested Node process. The correction uses `whoami /user /fo csv /nh`, extracts only the ASCII numeric SID and supplies `*SID` to `icacls`. No username decoding is needed. The directory and file retain disabled ACL inheritance and a single current-user FullControl grant.

## Changes

- `scripts/phase5-local.cjs`: use the current user SID for ACLs; validate the internal key; check required entry points and local port availability before spawning; add safe stage diagnostics and child start/exit handling. Existing DEV/TLS/migration/encryption checks remain intact.
- `scripts/phase5-startup.cjs`: allowlisted error categories, protected config validation, strict key validation, numeric Windows SID handling, loopback socket checks and Documents runtime checks. It validates compiled template/font paths and actually launches installed Chrome through Playwright to produce an in-memory PDF before starting Documents.
- `scripts/phase5-startup.test.cjs`: four regression tests for strict authentication, occupied-port ownership preservation, provider-error redaction and OEM-encoded Windows account names.
- Documents `src/main.ts` and new `src/startup-error.ts`: distinguish listen conflicts, OS permissions, invalid configuration and other initialization failures without printing raw errors or secret values. Authentication and Production browser requirements are unchanged.
- Documents `test/startup-error.test.ts`: diagnostic categorization/redaction regression coverage.

Examples of future categories include `PORT_IN_USE`, `LOCAL_CONFIG_READ`, `LOCAL_CONFIG_SAVE`, `LOCAL_IDENTITY_UNAVAILABLE`, `INTERNAL_API_KEY_INVALID`, `DEV_ATTESTATION_FAILED`, `BUILD_MISSING`, `TEMPLATE_FONT_INVALID` and `CHROME_LAUNCH_FAILED`. The launcher never kills or takes over an occupied port automatically.

## Verification completed

- `prepare-local` and `verify` both passed after the correction, including a repeated nested-Node invocation that previously reproduced the encoding failure.
- Existing internal API key, JWT secret, applicant pepper and encryption/hash keys were preserved. No credentials were printed or rotated. The existing Documents key passed its 64-character hex/diversity validation.
- Actual Windows ACL inspection confirmed that only the current user retains FullControl on the protected directory and config file.
- Chrome is installed under `C:\Program Files\Google\Chrome\Application\chrome.exe`. Playwright successfully launched it. Compiled dependencies, template partials and all four Hebrew/Latin fonts passed validation.
- Only the verified old local Phase 5 listener processes were stopped; all three services were then started again through the launcher. All listen exclusively on `127.0.0.1`.
- Documents `npm run build` and all **20 unit/HTTP tests** passed. All **4 launcher regression tests** passed.
- An authenticated request to the real Documents service generated and parsed a valid **three-page A4 Hebrew PDF** from the reviewed fictional two-parent fixture. Missing and wrong internal keys both returned 401. The sample is ignored at `.tmp/phase5-local/startup-smoke-two-parents.pdf`.
- The compiled Documents entry point was deliberately started a second time to verify that it now reports `PORT_IN_USE` and exits with status 1, without exposing the internal key or disturbing the running service.

| Service | Verified URL | Result |
| --- | --- | --- |
| Client | http://127.0.0.1:5185/ | HTTP 200 |
| Server | http://127.0.0.1:3185/ | HTTP 200 |
| Documents | http://127.0.0.1:3285/health | HTTP 200 |

The Server's existing liveness endpoint is `/`; no new `/health` route was added.

## Commands

From `C:\Users\User\Et-Laasot-2\EtLaasot-Documents`, run `npm run build` after Documents source changes. From `C:\Users\User\Et-Laasot-2\EtLaasot-Server`:

```powershell
node scripts/phase5-local.cjs prepare-local
node scripts/phase5-local.cjs verify
```

Run each service command in a separate terminal, from the same Server directory:

```powershell
node scripts/phase5-local.cjs documents
node scripts/phase5-local.cjs server
node scripts/phase5-local.cjs client
```

All three services were left running. A second startup attempt on an occupied port is now rejected with a useful category. Keep the running instance, or stop its verified owning terminal/process before restarting; do not start duplicate copies. No software installation was required.

No database records, migrations, Storage configuration, Production, Railway or remote branches were changed. All database verification queries were read-only. No commit, push or deployment was performed.
