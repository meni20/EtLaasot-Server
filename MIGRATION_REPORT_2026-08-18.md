# Neon to Supabase migration report

Date: 2026-08-18 (Asia/Jerusalem)

## Scope

- Source: Neon Postgres 17.10, `public` schema
- Target: Supabase project `EtLaasot` (`tmlnuqrwhdeplpeuuvwv`) in `Meni Projects`
- Target database: Postgres 17.6
- Existing Supabase-managed schemas, Auth, and Storage were preserved.
- The Neon source was not modified or deleted.

## Recovery artifacts

Backup directory:

`C:\Users\User\EtLaasot-migration-backups\20260818-184629`

| Artifact | SHA-256 |
| --- | --- |
| `neon-public-full.dump` | `4271567C194A456B3F102DDE7710BDC8A629F00B391D4F64787877770F7AD0E5` |
| `neon-public-schema.sql` | `DE866A0E9B66D8E65E0A18C8B99394254B1B854C874CD74BE8D453B315D0B2BD` |
| `neon-public-data.sql` | `E7470098241B2D326FB0A19093B153DA825CFBAC117273C97CA4A66D9E7E64A7` |
| `neon-public-manifest.txt` | `601BECFA5E747E5431CE7D7E6B5A7476A8D86250B8687F82314F40CEBEC0AAF2` |
| `server.env.neon-before-cutover` | `D69F764DE4B200962DAA33870F211A6FA40308CCD88FD0D1103B077EA5992A21` |

## Data verification

Every table was compared using both its row count and an order-independent MD5
fingerprint of all JSON row values. All 14 tables matched between the final
Neon read and Supabase.

| Table | Rows | Fingerprint |
| --- | ---: | --- |
| `attendee` | 320 | `eba966dd0c1f994485188f628c3d49dc` |
| `branch` | 5 | `a993db6120412a9b645c93d8c82836ad` |
| `calendar_month_background` | 1 | `2adc9df690ff29b245977a65dda69ba5` |
| `event` | 22 | `229b180ec8ecbaff7071ca12bb8e99b3` |
| `event_pairing` | 108 | `83675fc0e25f06576fe4d377b2c516f9` |
| `mentor_assignment` | 32 | `715ad33660ee36dbec1ded2dd77dc7a9` |
| `mentor_import` | 145 | `eb10b35d0014245e2e4102c820fa0ef6` |
| `roles` | 4 | `8646c0c51673cc1b6ce5095dea6f832f` |
| `schema_migrations` | 25 | `542c3999c2d687763482997166da88b2` |
| `trainee_import` | 41 | `cb78689d39d6d37834e9d8d213752f71` |
| `trainee_medications` | 32 | `861907fae5aaccd425f613b0e4eef8af` |
| `user` | 125 | `0ccb9b50fdbc9e0e9bf9f197c29bbaf6` |
| `user_roles` | 125 | `052bb351d13b01dc0ae89aeb83fa36a7` |
| `volunteer_activity` | 16 | `aea279e2f66250eb35397278f9bc014d` |

Total migrated rows: **1,001**

## Database verification

- 154 columns, 38 validated constraints, and two enum types were preserved.
- All 39 source indexes were preserved and valid.
- Four non-unique covering indexes were added for previously unindexed foreign
  keys; the final target has 43 valid indexes and zero unindexed foreign keys.
- All 14 public tables have RLS enabled.
- The non-superuser, non-`BYPASSRLS` role `etlaasot_app` has one explicit
  server-only RLS policy per table.
- Supabase security advisors returned no findings.
- Remaining performance notices are inherited source design: three keyless
  tables and unused-index notices expected on a newly cut-over database.
- Existing Storage remained at one bucket, 16 objects, and 9,355,351 bytes.
- Supabase Auth remained unchanged at zero users.

## Supabase MCP migrations

1. `import_neon_pre_data_schema`
2. `import_neon_post_data_constraints`
3. `add_missing_foreign_key_indexes`
4. `configure_etlaasot_app_role_access`

## Application verification

- The runtime database configuration now targets Supabase using
  `etlaasot_app`.
- TLS uses full certificate verification with
  `certs/supabase-prod-ca-2021.crt`.
- The CA fingerprint is
  `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.
- Runtime read and transactional write/rollback probes passed.
- `npm run migrate` passed and skipped all already-applied app migrations.
- `npm run build` passed.
- All 17 test suites and 80 tests passed.
- A production build started successfully against Supabase and
  `GET /` returned HTTP 200 with `{"ok":true}`.

## Rollback

The Neon database is still intact. To roll the local server back, restore the
database variables from
`C:\Users\User\EtLaasot-migration-backups\20260818-184629\server.env.neon-before-cutover`
into `.env` and restart the server. Keep Neon and the backup directory until
the Supabase deployment has been observed in normal use and accepted.

## Render production cutover

- Render workspace: `beni's workspace` (`tea-d67n0pusb7us73ec00ig`)
- Production server: `EtLaasot-Server` (`srv-d67n38h4tr6s739g1q9g`), Frankfurt
- Production client: `EtLaasot-Client` (`srv-d67ng67gi27c73a13e6g`)
- Compatible server commit: `80f7633720dd05124383c6c03732012ebc05b50f`
- Compatibility deploy: `dep-da28gtou01pc73bidba0` (`live`)
- Supabase cutover deploy: `dep-da28hnr7uimc739r7fh0` (`live`)
- Runtime connection: Supavisor session pooler in `eu-central-1` on port 5432
- Render environment variables were updated through Render MCP in merge mode;
  unrelated variables and secrets were preserved.
- `DB_SYNC=false` remains enforced in production.
- The production server and client both returned HTTP 200 after cutover.
- The production client bundle still points to the production server URL.
- Supabase recorded an active connection for `etlaasot_app` through Supavisor.
- Render reported no application error logs after the cutover.
- All 14 migrated-table row counts and fingerprints remained unchanged after
  deployment (1,001 total rows).
- Neon and the recovery artifacts remain untouched for rollback safety.
