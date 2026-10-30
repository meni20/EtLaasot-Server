# Parent Registration Phases 2–3 — DEV audit and approval checkpoint

> Historical audit checkpoint. On 2026-10-21 the user explicitly approved the DEV-only migration and deployments without a database backup or restore rehearsal, accepting disposable DEV data risk. That approval supersedes the backup/approval gates below. See `PARENT-REGISTRATION-DEV-ROLLOUT.md` for the authorized migration and release scope. Production remains excluded.

Audit date: 2026-10-21 (Asia/Jerusalem). **No push, merge, commit, database migration, deployment, new cloud resource or registration request was executed.**

**Decision: DEV PostgreSQL isolation is verified. The source is prepared for a feature-disabled DEV integration. Database migration/deployment approval must remain gated on a verified recoverable DEV backup and rehearsal of the revised migration. Active registration and Phase 4 are not ready for rollout.**

## 1. Repository preservation and remote reconciliation

| Repository | Current local branch | Local/remote DEV SHA | Finding |
| --- | --- | --- | --- |
| Server | `feature/parent-registration-backend` | `992e10d7cbd656de6238663c024a06dc1c6fff10` | All Phase 2 work remains uncommitted; remote DEV has not advanced |
| Client | `feature/parent-registration-frontend` | `cbd25a99e3e88abdcc1e15ad9518a81105d5468d` | All Phase 3 work remains uncommitted; remote DEV has not advanced |
| Documents | `dev` | `67ce63d5153cd3f482a7f06b47d76ac4f3691b64` | Clean and unchanged; no Documents integration/deployment in this task |

Remote heads were read directly with `git ls-remote`, not assumed from cached tracking refs. Server main is `589aa3acddccf08ab43077d5405581fd1622a62b`; Client main is `8c0d20bf280565b0ee7b09746cb4e3b15e4c0e73`. Both feature HEADs are their local DEV base; the features exist in their working trees, not in feature commits yet. Recent DEV history is the existing documents/PWA/push/calendar work, which remains intact. There is currently no remote DEV divergence to resolve. No branches were switched or rewritten.

Before any preparation edits, all Git-visible modified/untracked source was preserved as two ZIPs, two binary tracked patches and a SHA-256 manifest under:

`C:\Users\User\Et-Laasot-2\EtLaasot-Server\.tmp\parent-registration-dev-audit-20261021-fyrbw5g9`

The snapshot contains 33 Server and 32 Client source files. Ignored credentials, `.env` files, sandbox data and generated PDFs were not copied or staged and remain untouched. This is a **source-work backup**, not a database backup. Full current inventories are below.

## 2. Actual Railway environments and database identity

Railway project: `splendid-gratitude`, ID `e950a261-d932-48c2-bc19-86287cb374ef`.

DEV environment ID: `6b2b0ac3-9131-454c-9a42-4df26937f521`.

| Service | Service ID | Source / deployed commit | Current state |
| --- | --- | --- | --- |
| `EtLaasot-Server-dev` | `019690d4-5b69-4bff-b685-69c84053f85e` | `meni20/EtLaasot-Server`, branch `dev`, `992e10d…` | SUCCESS; GET `/` 200 |
| `EtLaasot-Client-dev` | `d8e6a080-0fc7-4cf6-af49-420d4b6fe42d` | `meni20/EtLaasot-Client`, branch `dev`, `cbd25a9…` | SUCCESS; GET `/` 200 |

- Existing DEV deployment IDs: Server `39c1cb8d-a119-4cb8-9ad3-613928df7419`; Client `68eb5756-14d9-4be9-aaf4-2b60b274a8a1`.
- Both use Railpack, one replica, automatic Node build/start detection. Configured build/start/pre-deploy commands and Railway healthcheck paths/timeouts are currently null. The `.railway-main` configuration copies belong to the separate main setup and are not the DEV service configuration.
- **Both DEV GitHub deployment triggers are enabled for branch `dev`, with check-suite waiting disabled. A push is itself a deployment-triggering operation.** CLI live schema/query access confirmed the triggers; no trigger/config was changed.
- Server DEV domain: `etlaasot-server-dev-dev.up.railway.app`. Client DEV domain: `etlaasot-client-dev-dev.up.railway.app`.
- The deployed Client's actual entry bundle contains the DEV API host and does not contain the main API host or registration mock marker. This was verified from the served static artifact, not just from current variable settings.
- CORS currently allows exactly the DEV Client origin with credentials. Protected `/user/me` returns 401 without credentials. Registration status returns 404 because registration is not enabled/deployed.

### Isolation evidence

| Boundary | Verified DEV | Main/Production comparison |
| --- | --- | --- |
| Supabase project | `EtLaasot-dev`, ref `vlysppqfozfiwcmsyban` | `EtLaasot`, ref `tmlnuqrwhdeplpeuuvwv` |
| Database route | `aws-0-eu-central-1.pooler.supabase.com:5432`, role qualified by DEV ref | `aws-1-eu-central-1.pooler.supabase.com:5432`, role qualified by Production ref |
| Supabase API / service key | DEV API hostname; in-memory JWT ref/role checks match DEV/service_role | Different API target and service credential |
| Runtime identity | Database `postgres`, role `etlaasot_app`, PostgreSQL 17.6 | A separate Supabase project; no Production SQL/data was queried |
| Transport | Client-to-pooler TLS encrypted and certificate-authorized | No TLS validation bypass used |

The live Railway DEV connection was made using its existing variables, passed in memory without outputting secrets. It accepted only the exact DEV host, database, qualified role and project URL, with certificate validation enabled and `default_transaction_read_only=on`. The actual database/server address matched the DEV-scoped Supabase connector's read-only attestation. All audit SQL transactions were read-only. No application startup was used to query the database.

The server address was `2a05:d014:8ef:5902:b67d:7199:8fac:e6d0/128`, port 5432. `pg_stat_ssl` reported no SSL on the internal pooler-to-Postgres leg; this does **not** mean the audit's external connection lacked TLS: the pg TLS stream separately reported `encrypted=true, authorized=true`. Supabase metadata identifies the DEV database as its own project instance.

The main environment's Server/Client variables point to the Production project/API. The additional Railway environment literally named `production` contains a legacy crashed Server service with no DB target variables and a separate Railway Postgres service. Neither is a target for this task, and neither was restarted, queried as a database or modified. Environment labels alone were not used as isolation evidence.

### Configuration findings to retain in the review

- Root Server `.env` is stale/mixed: its PostgreSQL route identifies Production while its Supabase API identifies DEV. It was **not used**, loaded into the audit process, edited or committed. Never launch a migration through this file or through an unverified shell environment. Existing branch-specific runtime validation must remain intact.
- Railway DEV has `BRANCH_NAME=dev`, `DB_SYNC=false`, a matching DEV Supabase URL and trusted DEV CORS origin. Registration and blocking flags are absent, so default to false; `DB_LOGGING` also defaults false.
- DEV and main have different JWT secrets and Supabase service credentials, but their existing national-ID hash/encryption key material compares equal. No values or fingerprints were printed. This is shared cryptographic material, **not** a shared database. Preserve the existing keys during this migration; key separation would require a separately reviewed rehash/re-encryption plan. Do not rotate them as part of this transfer.
- No tracked `.env` files were found. Secret-bearing Railway variable JSON was consumed only in memory and reduced to approved metadata/boolean checks before output.

## 3. Real DEV migration history and synthetic-schema differences

The application uses `public.schema_migrations` keyed by **full filename**, alongside Supabase's separate timestamp-based migration history. All repository migrations through 029 are already recorded. Only `030_parent_registration.sql` is outstanding in the current repository. There are 31 application-history rows: the two distinct `016_…` files are both valid filename entries, and one old history-only user-data migration no longer exists in the repository. Do not replay or recreate that historical user-data migration, renumber 016, delete history or run a synthetic baseline on DEV.

Supabase's separate history includes the original Neon import/role/access configuration plus PWA/push migrations through 029. These two history systems must both remain consistent if the Supabase migration API is used for 030.

Verified prerequisites: `public.user.id` is UUID with a primary key; `public.branch.id` is varchar(50) with a primary key; current user/role/medical columns exist; `gen_random_uuid()` exists. All six registration tables and the immutable-trigger function are absent, so there is no existing partial registration schema to overwrite. No preliminary UUID migration, extension installation or historical migration replay is required.

| Concern | Synthetic Phase 2 baseline | Actual DEV | Consequence |
| --- | --- | --- | --- |
| Owner/RLS | Test runner owns its newly created tables; owner-based access succeeds | Existing public tables owned by postgres; runtime `etlaasot_app` is non-owner, non-superuser, non-BYPASSRLS | Original 030 lacked the runtime role policies needed for DEV |
| Default table grants | Minimal baseline | postgres defaults grant client roles and etlaasot_app privileges | Explicit revocation and least-privilege server grants are necessary |
| Default function grants | No Supabase default ACL behavior | anon/authenticated/service_role receive explicit EXECUTE by default | Revoking PUBLIC alone was insufficient to remove those explicit function grants |
| `roles.id` | integer; role name varchar(100) | varchar(255); role name varchar(255) | Do not alter existing role identities; compatibility rehearsal must use the real schema |
| `user_roles` | Includes a role FK into synthetic integer roles | roleId integer, userId UUID; no equivalent FK into varchar roles.id | Do not transplant baseline constraints into DEV |
| Timestamps/booleans | Several nullable/default-now simplifications | Existing NOT NULL constraints and differing defaults | Restore/rehearse the actual schema; do not replace existing tables |
| Medical validation | Simplified medication table | Additional medication-name/frequency checks, strict nullability and FK actions | Preserve current records and constraints; registration medical synchronization stays manual |
| Supabase runtime | No existing migration history, default ACLs or DDL event trigger | Existing history, RLS auto-enable event trigger and managed roles | Test role grants and client denial explicitly; owner-only success is insufficient |

No existing user or medical row was read into logs, updated, deleted or overwritten. Catalogue queries inspected definitions, constraints, ACLs, history and role memberships. `anon`, `authenticated` and `service_role` are not members of `etlaasot_app`.

## 4. Local corrections prepared before approval

1. **Server 030 / migration regression test:** add explicit runtime-role policies on the six new tables. Revoke inherited app ACLs first; mutable registration tables receive required DML, immutable evidence tables only SELECT/INSERT. Existing immutable triggers remain. Explicit client-role function EXECUTE grants are revoked, and the runtime role receives the trigger-function privilege. No role creation, authentication bypass, SECURITY DEFINER or existing-table/data modification was added.
2. **Client environment helper / integration page / tests:** retain explicit matching loopback integration, and permit only the verified HTTPS Railway DEV API when `VITE_PARENT_REGISTRATION_ENVIRONMENT=dev` and both API URLs match. Production, arbitrary hosts, insecure DEV URLs, credentials, extra paths, query strings, fragments and mismatches fail closed. No fallback to another API.
3. **Client Phase 3 notes:** retain the original historical report and append the DEV opt-in amendment.

Current migration 030 SHA-256: `54026d76c6be718010003c30d666df7670eff3a390ea9386596522030ab7fe5a`.

**This revised SQL has not been executed in any database.** The previous six isolated DB tests passed before these new grant/policy corrections and are not proof of this revised migration. Its non-owner/ACL behavior must be rehearsed before real DEV application.

Login components, login routing and the Server authentication module are unchanged. The new Phase 4 ID-first discovery, independent registration, active-branch selection before account creation, approval-triggered account provisioning and later email delivery were not implemented. Migration 030 still represents registrations of existing user UUIDs; Phase 4 will need a reviewed applicant/account lifecycle extension. Annual/individual blocking remains disabled/unwired. Real uploads, submission and PDF approval remain deferred/accurately unavailable. Mock/demo files remain separate from production build output.

## 5. Checks rerun

| Check | Result |
| --- | --- |
| Server production `npm run build` | PASS |
| Server `npm run typecheck:parent-registration` | PASS |
| Server full `npm test -- --runInBand` | 40 suites / 282 tests passed |
| Server focused registration suite | 5 suites / 63 tests passed (subset of full suite) |
| Non-DB attestation unit tests | 13 passed |
| Client `npm run typecheck:registration` | PASS |
| Client model/API/environment tests | 11 passed |
| Client Playwright UX tests | 14 passed; installed Chrome; mock adapter only |
| Client production build + mock-exclusion check | PASS |
| Scoped Client lint / Git whitespace checks | PASS |
| Existing deployed DEV root/auth/CORS/static-bundle checks | PASS, read-only/unauthenticated |
| Revised migration on a restored/non-owner database | NOT RUN — approval/backup rehearsal gate |
| Real authenticated feature workflow / real upload/PDF | NOT RUN; unavailable or deliberately disabled |

Normal Server lint includes `--fix` and was not used to rewrite unrelated code. Unit-test mail/push log lines refer to mocks; no email or push was sent. No existing application server was started against any database. The old local PostgreSQL clusters and their databases were not connected to or changed.

## 6. Backup/recovery gate — currently NOT satisfied

The Supabase organization API reports **Free**. Customer-accessible daily backups/PITR cannot be presumed from project health or from the mere existence of a Supabase project. The backup dashboard required a new browser sign-in, and the available Supabase connector does not expose backup inventory/restore verification. Therefore **no specific usable backup, restore point or tested recovery artifact has been verified**. No backup was silently created or real DEV data exported.

PostgreSQL 17 `pg_dump.exe` and `pg_restore.exe` are installed locally; no software/Docker installation is required for the proposed rehearsal. Existing Railway app-role credentials are not sufficient evidence of owner-level/full backup privileges. A backup-capable DEV connection or operator-created DEV backup must first be supplied through a secure local mechanism/dashboard, never by pasting a password into chat. Do not reset existing credentials to obtain it.

Before allowing real DEV DDL, require:

- A project-identified, timestamped, complete DEV application/database backup plus its scope manifest and checksum, and protected retention of the existing application encryption/hashing configuration. No plaintext secret/config export to Git or report.
- A verified restore test into a **separate, explicitly approved local PostgreSQL 17 rehearsal cluster** at `127.0.0.1:55440`, with a new private data directory under `EtLaasot-Server/.tmp/parent-registration-dev-rehearsal-20261021`. This must not reuse or alter the fictional Phase 2 cluster at 55439 or other existing clusters.
- Fresh rehearsal-only credentials, owner/SYSTEM-only file access, no external listeners or outbound integrations. Any backup containing DEV records stays on this computer in protected, Git-ignored storage; the retained backup must be encrypted and its key protected with CurrentUser DPAPI. Never print rows, IDs, medical data, passwords or dump contents. Restoring existing DEV records locally requires explicit approval of that destination/scope as part of this gate.
- Restore verification of expected application tables, constraints and record counts/integrity without exposing rows. Review managed dependencies rather than silently dropping objects or weakening security. If the backup cannot be restored completely for its declared scope, stop.
- Apply the exact revised 030 to the rehearsal database and verify actual non-owner runtime read/write permissions, immutable evidence protection and denial of all client-role access using fictional local fixtures only. Confirm pre-existing copied application data remains unchanged. Keep the existing strict Phase 2 sandbox safeguards intact; do not simply point its empty/synthetic-baseline harness at a restored database.

The source ZIPs above and the prior fictional integration databases are **not** substitutes for a recoverable real DEV backup. Database backups also do not contain Storage object payloads; no Storage objects are changed by this rollout.

## 7. Proposed ordered DEV rollout — none executed

### A. Approval, backup and rehearse

1. Obtain approval of this report and the scoped next steps. Establish an agreed DEV no-write/maintenance window before the recovery checkpoint. Recheck exact DEV/Production target separation and remote heads. If a target changes or isolation fails, stop before any write.
2. Complete the backup/recovery gate above. Record the artifact identity, recovery point, verification result and approved storage location without secrets. No new Supabase project, Railway service or paid resource is proposed or authorized implicitly.
3. Rehearse the pinned 030 SQL against the restored schema with the actual non-owner role semantics. If any correction changes the SQL hash, rerun its tests/rehearsal and update this review before real DEV DDL.

### B. Prepare commits and DEV settings

4. In each existing feature branch, stage only the reviewed inventory below; never stage `.env`, secrets, snapshots, databases, uploads, logs, PDFs, node_modules or dist. Create one local reviewed feature commit per repository. Fetch `origin/dev` again. If it has advanced, merge it into the feature branch without losing its commits, resolve/review conflicts and rerun checks. Switch local dev only after the feature working tree is safely committed, fast-forward it to origin/dev, then fast-forward it to the reconciled feature branch. No force pushes, unrelated resets or main merges.

   Proposed messages: Server `feat(registration): prepare Phase 2 for guarded DEV integration`; Client `feat(registration): prepare Phase 3 for guarded DEV integration`. Actual new SHAs will exist only after approval/committing.

5. Stage only DEV service settings, without triggering a premature deployment: keep `BRANCH_NAME=dev`, `DB_SYNC=false`, `DB_LOGGING=false`, `PARENT_REGISTRATION_ENABLED=false`, `PARENT_REGISTRATION_BLOCKING_ENABLED=false`. On Client keep `VITE_PARENT_REGISTRATION_ENABLED=false`; set the DEV environment/API opt-in values below for future development. Preserve existing credentials, CORS and cookie settings. Set DEV healthchecks to `/` with a bounded timeout, using the exact DEV service/environment IDs. Do not change project-global or main/production settings. Do not add a pre-deploy command that runs all migrations.

### C. Exact migration, then push/deploy in order

6. Through a verified DEV owner connection, perform the final read-only preflight: history through 029, absence of all 030 objects, UUID/branch prerequisites, expected runtime role/default ACLs, backup receipt and exact approved SQL hash. Apply **only** 030 in one bounded transaction and add its exact filename to `public.schema_migrations` atomically. If the Supabase migration API is used, also retain its normal timestamped migration-history entry in that same managed application. Do not invoke the ordinary all-files `npm run migrate`, import baseline.sql, rerun identity/PWA migrations, seed an activity year, open annual registration or create requests/accounts. Any failure must roll back and stop; do not attempt a partial retry over existing objects.

7. Read-only post-migration verification: six new empty tables, RLS on, correct server policies/ACLs, client grants denied, immutable triggers/function grants present, history consistent, old tables/constraints and pre-migration data unchanged. Do not insert a real DEV test form to prove success.

8. Push Server local `dev` to `origin/dev`; this triggers its existing DEV Railway deployment. Wait for the exact new commit to reach SUCCESS and `/` 200. Only then push Client dev and wait for its exact commit/SUCCESS/200. Do not run an additional duplicate `railway up` for an already triggered deployment. If a normal push is rejected by branch protection or non-fast-forward checks, stop rather than bypassing protection.

### D. Acceptance and rollback

9. Confirm expected deployed SHAs, environment IDs, no migration/ORM-sync startup commands, DEV API in the built Client, no demo entry/fixtures, roots 200, protected routes 401 unauthenticated and matching credentialed CORS. Registration routes should remain 404 while the feature is off; that is expected. Existing login remains unchanged. Do not enable blocking, public registration, uploads, fake PDF readiness or account creation. Authenticated regression, if required, must use a designated fictional DEV test account with the operator's authorization; do not submit registration requests or edit user/medical profiles. Full feature behavior is still validated locally until a separate activation review.
10. Rollback application failures by restoring the known previous DEV deployments (Server `39c1cb8d-a119-4cb8-9ad3-613928df7419`, Client `68eb5756-14d9-4be9-aaf4-2b60b274a8a1`) or ordinary revert commits on dev. Keep all registration/blocking flags false. The additive new tables should remain; **no automatic DROP/down migration** and no deletion of immutable evidence. A true database recovery is a separate explicit DEV-only restore of the verified checkpoint after stopping DEV writers and agreeing the recovery-point impact. Never restore Production or change Storage as a shortcut.

All pushes, service-variable/healthcheck changes, database work, local restore provisioning and deployments above remain subject to approval. No new public endpoint or Phase 4 contract is part of this transfer.

### DEV variables for the proposed feature-disabled deployment

```text
# Server — existing DEV service only
BRANCH_NAME=dev
DB_SYNC=false
DB_LOGGING=false
PARENT_REGISTRATION_ENABLED=false
PARENT_REGISTRATION_BLOCKING_ENABLED=false
# Preserve existing DEV DB, Supabase, JWT and national-ID key settings.

# Client — existing DEV service only
VITE_SERVER_URL=https://etlaasot-server-dev-dev.up.railway.app
VITE_PARENT_REGISTRATION_ENABLED=false
VITE_PARENT_REGISTRATION_ENVIRONMENT=dev
VITE_PARENT_REGISTRATION_API_URL=https://etlaasot-server-dev-dev.up.railway.app
```

## 8. File review and remaining boundaries

Only these existing feature files were corrected by this audit: Server 030 and its migration test; Client integration page and model tests, plus the new environment helper and two appended historical documentation notes. This report is new. All other Phase 2/3 source is preserved from the work present at entry. No unrelated login, auth or medical implementation was rewritten. The inventories below include the entire proposed Phase 2/3 transfer, not just this audit's delta.

### EtLaasot-Server — full Git-visible inventory

- modified: [package.json](C:/Users/User/Et-Laasot-2/EtLaasot-Server/package.json)
- modified: [src/app.module.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/app.module.ts)
- new: [PARENT-REGISTRATION-DB-TEST-RESULTS.md](C:/Users/User/Et-Laasot-2/EtLaasot-Server/PARENT-REGISTRATION-DB-TEST-RESULTS.md)
- new: [PARENT-REGISTRATION-DEV-AUDIT.md](C:/Users/User/Et-Laasot-2/EtLaasot-Server/PARENT-REGISTRATION-DEV-AUDIT.md)
- new: [PARENT-REGISTRATION-PHASE2.md](C:/Users/User/Et-Laasot-2/EtLaasot-Server/PARENT-REGISTRATION-PHASE2.md)
- new: [PARENT-REGISTRATION-SANDBOX-DIAGNOSTICS.md](C:/Users/User/Et-Laasot-2/EtLaasot-Server/PARENT-REGISTRATION-SANDBOX-DIAGNOSTICS.md)
- new: [migrations/030_parent_registration.sql](C:/Users/User/Et-Laasot-2/EtLaasot-Server/migrations/030_parent_registration.sql)
- new: [scripts/diagnose-parent-registration-sandbox.cjs](C:/Users/User/Et-Laasot-2/EtLaasot-Server/scripts/diagnose-parent-registration-sandbox.cjs)
- new: [scripts/parent-registration-attestation.test.cjs](C:/Users/User/Et-Laasot-2/EtLaasot-Server/scripts/parent-registration-attestation.test.cjs)
- new: [scripts/parent-registration-sandbox.cjs](C:/Users/User/Et-Laasot-2/EtLaasot-Server/scripts/parent-registration-sandbox.cjs)
- new: [scripts/parent-registration-test-safety.cjs](C:/Users/User/Et-Laasot-2/EtLaasot-Server/scripts/parent-registration-test-safety.cjs)
- new: [scripts/recover-parent-registration-sandbox.cjs](C:/Users/User/Et-Laasot-2/EtLaasot-Server/scripts/recover-parent-registration-sandbox.cjs)
- new: [scripts/test-parent-registration-db.cjs](C:/Users/User/Et-Laasot-2/EtLaasot-Server/scripts/test-parent-registration-db.cjs)
- new: [src/modules/parent-registration/declarations.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-registration/declarations.ts)
- new: [src/modules/parent-registration/entities/registration.entities.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-registration/entities/registration.entities.ts)
- new: [src/modules/parent-registration/parent-registration.module.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-registration/parent-registration.module.ts)
- new: [src/modules/parent-registration/registration-access.policy.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-registration/registration-access.policy.ts)
- new: [src/modules/parent-registration/registration-document.generator.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-registration/registration-document.generator.ts)
- new: [src/modules/parent-registration/registration.controller.spec.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-registration/registration.controller.spec.ts)
- new: [src/modules/parent-registration/registration.controller.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-registration/registration.controller.ts)
- new: [src/modules/parent-registration/registration.dto.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-registration/registration.dto.ts)
- new: [src/modules/parent-registration/registration.entities.spec.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-registration/registration.entities.spec.ts)
- new: [src/modules/parent-registration/registration.guard.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-registration/registration.guard.ts)
- new: [src/modules/parent-registration/registration.migration.spec.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-registration/registration.migration.spec.ts)
- new: [src/modules/parent-registration/registration.repository.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-registration/registration.repository.ts)
- new: [src/modules/parent-registration/registration.service.spec.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-registration/registration.service.spec.ts)
- new: [src/modules/parent-registration/registration.service.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-registration/registration.service.ts)
- new: [src/modules/parent-registration/registration.test-fixtures.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-registration/registration.test-fixtures.ts)
- new: [src/modules/parent-registration/registration.validation.spec.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-registration/registration.validation.spec.ts)
- new: [src/modules/parent-registration/registration.validation.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/src/modules/parent-registration/registration.validation.ts)
- new: [test/parent-registration/baseline.sql](C:/Users/User/Et-Laasot-2/EtLaasot-Server/test/parent-registration/baseline.sql)
- new: [test/parent-registration/jest-db.json](C:/Users/User/Et-Laasot-2/EtLaasot-Server/test/parent-registration/jest-db.json)
- new: [test/parent-registration/lifecycle.db-spec.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Server/test/parent-registration/lifecycle.db-spec.ts)
- new: [test/parent-registration/tsconfig.json](C:/Users/User/Et-Laasot-2/EtLaasot-Server/test/parent-registration/tsconfig.json)

### EtLaasot-Client — full Git-visible inventory

- modified: [.gitignore](C:/Users/User/Et-Laasot-2/EtLaasot-Client/.gitignore)
- modified: [package-lock.json](C:/Users/User/Et-Laasot-2/EtLaasot-Client/package-lock.json)
- modified: [package.json](C:/Users/User/Et-Laasot-2/EtLaasot-Client/package.json)
- modified: [src/components/SideMenu/SideMenu.constants.tsx](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/components/SideMenu/SideMenu.constants.tsx)
- modified: [src/constants/route.constants.tsx](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/constants/route.constants.tsx)
- modified: [src/pages/Mobile/ProfilePage/Profile.tsx](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/pages/Mobile/ProfilePage/Profile.tsx)
- new: [PARENT-REGISTRATION-PHASE3-RESULTS.md](C:/Users/User/Et-Laasot-2/EtLaasot-Client/PARENT-REGISTRATION-PHASE3-RESULTS.md)
- new: [PARENT-REGISTRATION-PHASE3.md](C:/Users/User/Et-Laasot-2/EtLaasot-Client/PARENT-REGISTRATION-PHASE3.md)
- new: [parent-registration-demo.html](C:/Users/User/Et-Laasot-2/EtLaasot-Client/parent-registration-demo.html)
- new: [playwright.registration.config.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Client/playwright.registration.config.ts)
- new: [scripts/check-registration-build.mjs](C:/Users/User/Et-Laasot-2/EtLaasot-Client/scripts/check-registration-build.mjs)
- new: [src/features/parent-registration/Fields.tsx](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-registration/Fields.tsx)
- new: [src/features/parent-registration/LiveRegistrationPage.tsx](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-registration/LiveRegistrationPage.tsx)
- new: [src/features/parent-registration/RegistrationAdmin.tsx](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-registration/RegistrationAdmin.tsx)
- new: [src/features/parent-registration/RegistrationMobile.tsx](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-registration/RegistrationMobile.tsx)
- new: [src/features/parent-registration/SignaturePad.tsx](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-registration/SignaturePad.tsx)
- new: [src/features/parent-registration/Stages.tsx](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-registration/Stages.tsx)
- new: [src/features/parent-registration/api.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-registration/api.ts)
- new: [src/features/parent-registration/contracts.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-registration/contracts.ts)
- new: [src/features/parent-registration/demo/adapter.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-registration/demo/adapter.ts)
- new: [src/features/parent-registration/demo/legal.fixture.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-registration/demo/legal.fixture.ts)
- new: [src/features/parent-registration/demo/main.tsx](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-registration/demo/main.tsx)
- new: [src/features/parent-registration/demo/preview.css](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-registration/demo/preview.css)
- new: [src/features/parent-registration/environment.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-registration/environment.ts)
- new: [src/features/parent-registration/hooks.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-registration/hooks.ts)
- new: [src/features/parent-registration/legal.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-registration/legal.ts)
- new: [src/features/parent-registration/model.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-registration/model.ts)
- new: [src/features/parent-registration/stageNames.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-registration/stageNames.ts)
- new: [src/features/parent-registration/useDraft.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Client/src/features/parent-registration/useDraft.ts)
- new: [tests/registration-ui/registration.spec.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Client/tests/registration-ui/registration.spec.ts)
- new: [tests/registration.model.test.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Client/tests/registration.model.test.ts)
- new: [tsconfig.registration.json](C:/Users/User/Et-Laasot-2/EtLaasot-Client/tsconfig.registration.json)
- new: [vite.registration.config.ts](C:/Users/User/Et-Laasot-2/EtLaasot-Client/vite.registration.config.ts)

## References checked

- [Supabase backup scope, retention and restore behavior](https://supabase.com/docs/guides/platform/backups)
- [Railway GitHub autodeployment behavior](https://docs.railway.com/deployments/github-autodeploys)
- [Railway public API](https://docs.railway.com/integrations/api)
- Supabase changelog index was read; no new Supabase SDK/auth integration is introduced by this task.

**Historical approval status at audit completion: waiting.** The subsequent explicit user approval is recorded at the beginning of this report and in `PARENT-REGISTRATION-DEV-ROLLOUT.md`. No backup or restore rehearsal was claimed or performed.
