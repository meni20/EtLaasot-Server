# Registration: Production release readiness and runbook

Prepared 2026-10-30. **Preparation only: no Production configuration, deployment, database, Storage, credentials, or GitHub `main` changes were performed.** No DEV data may be copied into Production. This runbook is not an automatic deployment/migration script.

## 1. Fixed environment identities

| Setting | DEV | Production |
| --- | --- | --- |
| Railway project | `e950a261-d932-48c2-bc19-86287cb374ef` | Same project, separate environment |
| Railway environment/name | `6b2b0ac3-9131-454c-9a42-4df26937f521` / `dev` | `b5bc66a8-10fd-45ac-af6b-99a84c84a338` / `main` |
| Git branch / Node environment | `dev` / `development` | `main` / `production` |
| Server service | `019690d4-5b69-4bff-b685-69c84053f85e` | `0172d945-f6bf-43ae-8ccb-dc4cf318604b` |
| Client service | `d8e6a080-0fc7-4cf6-af49-420d4b6fe42d` | `b9306c97-9da0-45f1-abdb-e8eddf842e2d` |
| Supabase project | `vlysppqfozfiwcmsyban` / EtLaasot-dev | `tmlnuqrwhdeplpeuuvwv` / EtLaasot |
| Supabase pooler | `aws-0-eu-central-1.pooler.supabase.com` | `aws-1-eu-central-1.pooler.supabase.com` |
| Supabase login | `etlaasot_app.vlysppqfozfiwcmsyban` | `etlaasot_app.tmlnuqrwhdeplpeuuvwv` |
| Server origin | `https://etlaasot-server-dev-dev.up.railway.app` | `https://etlaasot-server-main-main.up.railway.app` |
| Client origin | `https://etlaasot-client-dev-dev.up.railway.app` | `https://etlaasot-client-main-main.up.railway.app` |

The separate Railway environment literally named `production` (`fbe377e8-a3e6-4e69-9149-42e1cccf5142`) contains a legacy service and is **not** the approved target. Do not change it. Runtime attestation rejects it. Production's existing DB/Supabase identifiers and TLS settings were checked through read-only Railway configuration access; values of secrets were never printed.

Client requires an explicit matching environment/API-origin pair. Server verifies the runtime/project/environment identity, branch, exact Supabase URL, pooler, port, project-bound application login, service-role key ref/expiry, and TLS. Every enabled registration pool connection verifies its certificate and checks database/role/port and absence of superuser/BYPASSRLS before ORM work. Database IP addresses are deliberately not identity: Supabase can rotate them. DEV-only local integration remains limited to the DEV project, with no Railway identity present.

## 2. Required Production configuration (names, not secret values)

Preserve existing Production values unless the release requires an explicitly listed change. Never copy the DEV environment wholesale. Do not regenerate `JWT_SECRET`, `NATIONAL_ID_HASH_SECRET`, `NATIONAL_ID_ENCRYPTION_KEY`, database passwords, push/mail credentials, or existing account credentials. Changing identity/encryption keys would break access to existing data. Keep `.env.*.local` files out of deployment archives; the existing runtime loader can override `NATIONAL_ID_ENCRYPTION_KEY` from such a file. Use a clean tracked-source checkout and environment-owned variables.

### Server: EtLaasot-Server-main, environment main

| Variable | Required configuration |
| --- | --- |
| `NODE_ENV`, `BRANCH_NAME` | `production`, `main` |
| `RAILWAY_PROJECT_ID`, `RAILWAY_ENVIRONMENT_ID`, `RAILWAY_ENVIRONMENT_NAME`, `RAILWAY_SERVICE_ID` | Railway-supplied identities matching section 1; never spoof them |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` | Production pooler above, `5432`, `postgres`, Production project-bound app login above |
| `DB_PASS` | Preserve existing Production application-role password |
| `DB_SSL`, `DB_SSL_REJECT_UNAUTHORIZED`, `DB_SSL_CA_PATH` | `true`, `true`, existing trusted CA file available in the runtime image |
| `DB_SYNC`, `DB_LOGGING` | Explicit `false`, `false`; never use synchronization as a migration |
| `SUPABASE_URL` | `https://tmlnuqrwhdeplpeuuvwv.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Existing valid, unexpired Production project `service_role` JWT; server-only. Opaque keys are not accepted by this attestation. Supabase authenticates the key; decoding claims alone is not signature verification. |
| `SUPABASE_TRAINEE_DOCUMENTS_BUCKET` | `trainee-documents`, in Production Supabase only |
| `PARENT_REGISTRATION_TOKEN_PEPPER` | New Production-only cryptographically generated 32-byte hex secret; stable thereafter; do not reuse DEV or log it |
| `REGISTRATION_DOCUMENTS_URL` | `http://etlaasot-documents.railway.internal:3000/` in environment **main** |
| `REGISTRATION_DOCUMENTS_API_KEY` | New Production-only random 32-byte lowercase hex secret shared only with Production Documents `INTERNAL_API_KEY` |
| `CORS_ORIGINS` | Preserve legitimate existing origins; include the Production Client origin; exclude DEV/localhost origins |
| `PARENT_REGISTRATION_ENABLED` | Final `true`; see staged activation below |
| `PARENT_ADMISSION_SCHEMA_READY` | Final `true` only after verified migrations 030–036 |
| `PARENT_REGISTRATION_INTEGRATION_ENABLED` | Final `true` only after schema, private bucket, Documents service/key and connectivity are ready |
| `APPLICANT_REGISTRATION_ENABLED`, `ID_FIRST_LOGIN_ENABLED`, `VOLUNTEER_REGISTRATION_ENABLED` | Final `true`, activate after backend dependencies are ready |
| `PARENT_REGISTRATION_BLOCKING_ENABLED` | **Keep `false`** for this rollout; enforcing renewal-related login blocking requires a separate business decision |

Do not rotate/rewrite existing Production credential values. Generate only missing, new registration-specific secrets; store them in Railway's secret configuration and a restricted recovery store. Check Production/DEV secret separation by in-memory comparison without displaying either value.

### Client: EtLaasot-Client-main, environment main

These are Vite **build-time** settings; variable changes require a new Client build.

| Variable | Final value |
| --- | --- |
| `VITE_SERVER_URL` | Production Server origin in section 1 |
| `VITE_PARENT_REGISTRATION_API_URL` | Exactly the same Production Server origin |
| `VITE_PARENT_REGISTRATION_ENVIRONMENT` | `production` (not the Railway name `main`) |
| `VITE_PARENT_REGISTRATION_ENABLED` | `true` after Server is ready |
| `VITE_APPLICANT_REGISTRATION_ENABLED` | `true` after Server is ready |
| `VITE_ID_FIRST_LOGIN_ENABLED` | `true` after Server is ready |
| `VITE_VOLUNTEER_REGISTRATION_ENABLED` | `true` after Server is ready |
| `VITE_PARENT_REGISTRATION_BLOCKING_ENABLED` | `false` |

No database credentials, JWT signing/encryption keys, pepper, service-role key or Documents key may appear in any `VITE_*` variable. Preserve unrelated public settings.

### Documents: private instance in environment main

Create an isolated **main-environment instance** of the existing `EtLaasot-Documents` service, using `meni20/EtLaasot-Documents`, branch `main`, and its committed Dockerfile. Its private DNS must remain `etlaasot-documents.railway.internal` within main. No public domain, cross-environment reference, DEV proxy, or shared DEV runtime is allowed. Do not repurpose the running DEV instance.

Variables: `NODE_ENV=production`, `PORT=3000`, `PDF_BROWSER_CHANNEL=chromium`, `PDF_TIMEOUT_MS=30000`, `PDF_MAX_CONCURRENT=2`, and secret `INTERNAL_API_KEY` matching Production Server `REGISTRATION_DOCUMENTS_API_KEY`. `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` is set by the Dockerfile. Reuse the existing non-root container with bundled Playwright Chromium, Hebrew fonts and templates. Do not give Documents Supabase/database keys; it renders bytes received privately from the Server. The private authenticated `POST /internal/documents/render` with empty JSON must return 400 (validation); 401 indicates a key mismatch. This probe contains no user data and does not render a document.

### Production Storage

Verify `trainee-documents` in the **Production** Supabase project. Reuse it if it already exists; never empty, replace or recreate it. If absent, create a new private bucket only during the separately authorized release. Require `public=false`, PDF/PNG/JPEG MIME support, adequate limits for files up to 10 MiB, no anonymous/authenticated access to registration prefixes, and server-authorized retrieval. The same bucket name in two projects refers to different storage. Audit current policies and existing document access before changing any bucket setting. Database migrations do not configure Storage. Preserve all existing objects and paths.

## 3. Migration audit: existing 030–036, unchanged

The prior read-only Production audit found `public.schema_migrations` through 029 and no registration tables. This observation is not permission to skip a fresh release-time preflight. No migration was run during readiness preparation.

| Migration | Dependency / effect | Safety and validation |
| --- | --- | --- |
| `030_parent_registration.sql` | Existing UUID users/branches through 029; creates six renewal/year/history/evidence tables, indexes, RLS and immutable triggers | Does not update users, passwords, roles or documents. Requires `gen_random_uuid()`, PL/pgSQL and owner-level DDL rights. New tables must not already exist. Creates immutable trigger function used by 031. |
| `031_parent_applications.sql` | 030; creates six shared admission/session/version/evidence/event/rate-limit tables | National-ID uniqueness remains global. All FKs use restrictive deletion; immutable versions/evidence/events. No account provisioning or seed data. |
| `032_registration_medical_image_mime.sql` | 030+031; replaces MIME CHECK constraints | Adds medical JPEG/PNG support while preserving PDF/signature restrictions. Named constraints must match expected definitions. No rows rewritten. |
| `033_application_registration_types.sql` | 030–032; adds type columns, defaults, type-specific constraints/FKs/indexes | Existing rows default to TRAINEE; signatures/versions remain immutable. New constraints validate existing rows, so inspect any unexpected pre-existing rows before applying. |
| `034_volunteer_clearance_images.sql` | 033; replaces admission MIME CHECK | Permits byte-validated police-clearance PDF/PNG/JPEG; it does not establish document authenticity. |
| `035_volunteer_pdf_metadata.sql` | 033+034; adds PDF metadata and event-version FK/index, replaces event-action CHECK | Existing fields/evidence retained; already-present VOLUNTEER PDFs would need valid metadata or migration fails. In the expected new empty Production admission tables there are none. |
| `036_application_review_reasons.sql` | 031+035 in release order; adds nullable audit reason | No row deletion, identity rewrite, secret change or new permissions. Supports reasoned manager recovery audit events. |

030–036 do not contain user/role/account DML, data-copy, reset, TRUNCATE or DROP TABLE operations. The DROP CONSTRAINT operations replace named constraints on registration tables; they are transactional, not instructions to delete records. 033 adds columns with defaults, and CHECK/FK validation plus normal index creation can take locks. Execute while all registration flags remain off and no registration writes are possible. Use a short lock timeout and a bounded statement timeout; if unavailable locks, schema drift or failed validation occur, rollback that migration and stop. Do not disable RLS/triggers to force it through.

Preflight must verify:

- Exact Production project and database identity; `public.user.id` UUID PK, `public.branch.id` compatible varchar key, migrations through 029, no unexpected pending older migration or partial registration objects.
- Runtime role `etlaasot_app` exists, is neither owner/superuser/BYPASSRLS nor a member of privileged roles. Use a separate existing authorized owner connection for DDL, never elevate the app login.
- The owner session has trusted `search_path=public,pg_catalog`; 030 contains intentionally unqualified table names. Pin this within each migration transaction; never change the global search path.
- Supabase default ACLs/event triggers cannot add unintended client access. Verify resulting table/function ACLs, RLS, enabled immutable triggers, validated constraints and valid/ready indexes. Browser roles PUBLIC/anon/authenticated/service_role must not read or write registration tables; only the application server uses the dedicated runtime grants. Storage service-role use is separate.
- Compare exact pending filenames and canonical-LF source checksums below. Existing completed migrations must never be reapplied.

Approved workflow: apply the reviewed SQL **one file at a time in ascending order**, using the Supabase migration API with the existing owner context and correct Production project reference. Include that file's `public.schema_migrations` entry in the same transaction so both the Supabase ledger and application ledger agree. Set local lock/statement timeouts and search path in the transaction. Do not invoke the blanket `npm run migrate` runner without first proving the pending set is exactly these seven files; historical migrations include data-changing operations. Do not run fixtures, seeds, bootstrap-password scripts or DEV operational helpers against Production.

## 4. Backup and preservation gates

Before any Production migration, create a restricted, encrypted-at-rest or access-controlled Production recovery archive/snapshot. Capture a consistent database recovery point covering application tables/data, grants, RLS, triggers/functions and both migration ledgers; inventory existing users, roles and document references without printing their contents. Include Auth metadata if used. Keep custom-role credential recovery material separately in a protected secret store; never rotate existing credentials as part of release.

Verify archive readability, checksum, table-of-contents completeness and a restore rehearsal in an isolated disposable destination with original role/data ownership accounted for. Never test restore against Production or DEV. Record the backup time, project ref, protected path, checksums, method and restore procedure. Stop if backup or restoration capability cannot be verified.

Database backups contain Storage metadata, **not file bytes**. Separately confirm recoverability/inventory of existing private Storage objects and preserve bucket policies, secrets, configuration and prior deployment artifacts. Retain backups through release acceptance. No backup was taken in this preparation task, and no existing backup is claimed as verified.

## 5. Exact release sequence — future authorized release only

1. Capture fresh remote main/dev SHAs, current Production service/deployment IDs, current non-secret configuration and private secret recovery references. Confirm the currently uploaded Production artifacts correspond to the expected main release, or reconcile source differences before connecting automatic GitHub deployment. Stop if artifact/source identity cannot be verified. Freeze a release candidate containing only committed DEV changes. Exclude local event/storage changes and all local `.env`/backup/fixture files. Recheck drift and essential builds/type checks. Keep registration/blocking flags off in both Client and Server while preparing dependencies. Batch each configuration stage using Railway's staging/no-deploy option, then trigger one controlled deployment; do not let individual variable updates launch unready intermediate configurations.
2. Verify backup/restore gates and Production DB/Storage preflight above. Prepare missing Production-only registration secrets without overwriting existing keys. Review the actual Production private bucket and its recoverability. No DEV bucket, row, activity year, account or document may be copied.
3. Configure GitHub `main` sources for the two existing main services and the isolated Documents main instance. Confirm environment **main**, existing domains, environment variables and service IDs before accepting any automatic deployment. These source changes can trigger deployment; keep feature flags off and initially deploy only existing main code. Never target Render or the legacy Railway environment named production. Record/coordinate each trigger so an unready backend cannot be exposed.
4. Merge the approved DEV release into Documents main, preserving its Dockerfile/Production configuration. Deploy its main instance with its new shared secret and verify the private authenticated empty-body validation probe. No actual applicant data is needed. Then merge the approved Server/Client releases into their main branches with all registration flags still off; record exact SHAs and healthy baseline deployments. Their release code is now present but dormant.
5. Apply only missing migrations 030–036 in order, with ledger entries and verification after each file. Recheck all pre-existing user/role/document inventories and constraints/permissions; no data or password changes should occur. Leave unrelated schema untouched.
6. Set Server `PARENT_ADMISSION_SCHEMA_READY=true` and `PARENT_REGISTRATION_ENABLED=true`, then enable `PARENT_REGISTRATION_INTEGRATION_ENABLED=true` once the private bucket/Documents dependencies pass. Keep `PARENT_REGISTRATION_BLOCKING_ENABLED=false`. Keep applicant/ID-first/volunteer flags off initially. Parent-registration must load the integration provider before integration startup attestation is enabled. Redeploy and require SUCCESS/RUNNING plus root `{ok:true}` and successful attestation logs; no secret-bearing logs are allowed.
7. Enable Server `APPLICANT_REGISTRATION_ENABLED`, `ID_FIRST_LOGIN_ENABLED`, `VOLUNTEER_REGISTRATION_ENABLED` together after backend readiness. Redeploy and verify healthy startup. Then set final Client URL/environment/feature values from section 2 and rebuild/deploy Client last. Verify deployed SHAs, SUCCESS/RUNNING, HTTP 200 HTML/API root, no DEV endpoints in built Production configuration, correct CORS, and unchanged existing password login/permissions. Any requested functional verification must use explicitly authorized synthetic Production data; do not log in as a real user or run DEV fixtures. No browser automation is required by this runbook.
8. Create an organization-approved Production activity year/branch registration periods only through the authorized administrative workflow when needed. Migrations deliberately seed none; never copy the fictional DEV year or invent dates. Keep renewal/login blocking off until separately approved. Record final configuration and acceptance.

## 6. Rollback and stop conditions

- Save previous deployed artifacts/SHAs and environment configuration before connecting GitHub sources or deploying. Do not assume an upload-based prior deployment can be reconstructed from an unverified Git SHA.
- On a readiness/configuration/attestation failure, stop activation. Revert Client feature flags/build and turn off Server applicant/ID-first/volunteer/integration flags; if reverting to pre-registration code, disable all parent/admission flags together. Keep blocking disabled. Redeploy the prior healthy code/configuration in dependency-safe order (Client first to hide entry points, then Server). Do not alter existing JWT, identity/encryption, password or other credentials.
- Leave additive schema, submissions, signatures and Storage objects intact. Do not undo migrations with DROP/DELETE, reset sequences, revoke existing user roles or recreate databases/buckets. If new applications were accepted, preserve their session pepper and Documents key as recovery dependencies even while features are off. Re-enable using compatible code later.
- Restore is a separate incident action only after reviewing potential loss of post-backup writes and reconciling Storage objects. Never automatically restore Production as deployment rollback.
- Stop on missing/ambiguous target identity, unverified backup, schema/history mismatch, unsafe default grants, different credentials/project references, public registration storage, Documents crossing environments, missing Production year/business setup needed by the acceptance criteria, or failed deployment health. Do not bypass guards or substitute DEV data.

## 7. Preparation validation and remaining work

Readiness changes affect only Client URL selection, Server shared environment/connection attestation, focused offline boundary checks and this runbook. Documents code/templates already support its Production Docker runtime and need no modification in this preparation phase. Production service provisioning, GitHub source linking, secret/bucket configuration, backups, migrations, main merges and deployment remain **not performed** and must follow section 5 during the future release.

Focused boundary checks use synthetic key-shaped strings and make no database/network calls. Essential Client/Server builds and type checks validate compilation; they do not establish that unconfigured Production dependencies are ready. DEV deployment SHAs and actual health are reported separately in the task completion report.

### Canonical migration source SHA-256 (UTF-8 with LF line endings)

This list is generated from the unchanged reviewed migration sources; CRLF working-copy conversions are normalized to Git-style LF before hashing.

| Migration | SHA-256 |
| --- | --- |
| `030_parent_registration.sql` | `54026d76c6be718010003c30d666df7670eff3a390ea9386596522030ab7fe5a` |
| `031_parent_applications.sql` | `d6ed51ac896fc9463aefd92ab0f7f6f3780ad2e030e274b0eb292196dc365fd9` |
| `032_registration_medical_image_mime.sql` | `88862769e6473a8baa36e5163090c201605d9f047a1f190b8f986560388365a7` |
| `033_application_registration_types.sql` | `3793ee6624ced6f20a152e7d7d34a04c43f7fe106ef1658dd29b86bea2abcdc2` |
| `034_volunteer_clearance_images.sql` | `5aa34352bbb5ce2248a2c7ea7c4612bb9cbca8fdd258ced7653d2abb16d5d300` |
| `035_volunteer_pdf_metadata.sql` | `9b51153ead73cfaf259318a17b7db8d1d4919bc013b5759343b66c4d289007aa` |
| `036_application_review_reasons.sql` | `52d7002e20a70de0e6db1caba005d0af51ec6be5fdaf08a122876caefc698423` |
