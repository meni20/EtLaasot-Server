# EtLaasot-Server

## Local setup

1. Create the ignored `.env.production.local` and `.env.development.local`
   secret files. Production must point to Supabase project
   `tmlnuqrwhdeplpeuuvwv`; development must point to
   `vlysppqfozfiwcmsyban`.
2. For an empty local database only, set `DB_SYNC=true` once and start the server so Sequelize creates the base tables. Set it back to `false` afterward.
3. Run `npm run migrate` to apply database schema changes, constraints, and indexes from `migrations/`.
4. Run `npm run seed` to create baseline roles, branches, and the local admin user.
5. Start the API with `npm run start:dev`.

## Branch-based environment selection

The API and migration runner select their Supabase project from the Git branch:

- Exact branch `main`: `.env.production.local` and the `EtLaasot` production
  project.
- Every other branch, detached HEAD, or unknown branch:
  `.env.development.local` and the `EtLaasot-dev` project.

On Render, `RENDER_GIT_BRANCH` is used instead of invoking Git. Other supported
CI variables are `GITHUB_HEAD_REF`, `GITHUB_REF_NAME`,
`CI_COMMIT_REF_NAME`, and `BRANCH_NAME`.

Startup fails closed if `DB_USER` or `SUPABASE_URL` identifies the opposite
project. Keep both local environment files untracked and store deployed values
as Render secrets. `NODE_ENV` never decides the database target.

## Render runtime

The Render web service should use Node 20 or newer, build with `npm run build`, and start with `npm start` or `npm run start:prod`. Both start commands run the compiled `dist/main` entrypoint.

The root route (`/`) returns `{ "ok": true }` and can be used as a simple health check.

## Deployment order

Production deployments should keep `DB_SYNC=false`, provide a long random `JWT_SECRET`, set strict `CORS_ORIGINS`, and run `npm run migrate` against the target database before starting the updated server with `npm run start:prod`.

Sequelize does not automatically alter existing tables in this app. `DB_SYNC=true` is only for creating base tables in an empty local database and is configured with `alter: false`.

## Migration failure mode

If the updated server starts before `npm run migrate` has added a new model column to the target database, requests that read or write that model can fail with PostgreSQL `42703` errors such as `column "gender" does not exist` or `column "gender" of relation "user" does not exist`.

For the user gender field specifically:

- Volunteer and trainee list endpoints may return a server error because Sequelize selects the `gender` column from the `user` table.
- Creating a volunteer or trainee may return a server error because Sequelize inserts the `gender` value into the `user` table.
- Existing users with `NULL` gender are valid after the migration and display as `-` in the client tables.

The stored gender values are lowercase strings: `male` and `female`.

## Trainee documents (backend V1)

Apply `migrations/024_create_trainee_documents.sql` through the existing migration
runner before enabling the feature. Keep `DB_SYNC=false`. The migration does not
create Storage resources or change the user table. Metadata has RLS enabled and
no direct `anon`/`authenticated` access. The server DB role must own the table or
have an explicitly reviewed server-only access policy and grants; do not grant
browser roles access to resolve a permissions error.

For each environment, an operator must create a **private**, separate bucket
(recommended name `trainee-documents`) and set these server-only variables using
the existing branch-selected environment configuration:

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (existing configuration).
- `SUPABASE_TRAINEE_DOCUMENTS_BUCKET=trainee-documents` (new, required for Storage operations).

Configure the bucket file-size limit as **10485760 bytes**, and allowed MIME types
as `image/jpeg`, `image/png`, `image/webp`, and `application/pdf`. Verify the project
limit permits this size. Audit existing Storage policies so none grant browser
roles access to this bucket; the Nest server uses its service-role key. Do not
make the bucket public. The adapter checks bucket privacy before each operation
and fails closed on missing/public/unavailable buckets. No fallback to event
images or a hard-coded project is used. Never put the service-role key in client
configuration. Deployment setup is manual; application startup creates no bucket.

Both route bases expose the same operations:

| Method | Self-service | Administrator |
| --- | --- | --- |
| GET | `/user/me/documents` | `/trainee/:traineeUuid/documents` |
| PUT | `/user/me/documents/:documentType` | `/trainee/:traineeUuid/documents/:documentType` |
| DELETE | `/user/me/documents/:documentType` | `/trainee/:traineeUuid/documents/:documentType` |
| GET | `/user/me/documents/:documentType/view` | `/trainee/:traineeUuid/documents/:documentType/view` |

Types: `MAGNETIC_CARD`, `ID_APPENDIX`, `QUEUE_EXEMPTION`. PUT requires exactly one
multipart `file` and no text fields. Files must be non-empty and at most 10 MiB;
extension, declared MIME, and detected magic-number MIME must agree. Signature
detection is not malware scanning or full PDF/image parsing. Stored filenames
are sanitized metadata only. Object keys contain UUID/type/random UUID and a
validated extension. No uploader identity is recorded.

JWT authentication, required password changes, trainee-role checks, and branch
authorization execute before upload buffering. Self-service always uses the
actor ID; admin uses `assertAdminForUserUuid`. Archived trainees remain accessible
to authorized admins. Existing auth-context caching applies (default 1 second).
Cookie-authenticated PUT/DELETE requests also require an Origin in `CORS_ORIGINS`
(localhost defaults only outside production). Bearer-authenticated API clients
do not need an Origin header. Include the application's same-origin URL in
`CORS_ORIGINS` if deployed behind a same-origin proxy.

Metadata DTOs expose only id, documentType, originalFilename, mimeType, fileSize,
createdAt and updatedAt. Normal user/profile/attendee/event responses are
unchanged. Document responses use `Cache-Control: private, no-store`.
View returns `{ signedUrl, expiresAt }`, with a 60-second signed URL. URLs are
temporary bearer credentials and are not individually revoked by application
logout or role changes. Do not persist, log or offline-cache them.

Replacement uploads a fresh object first, serializes metadata mutations using a
short parent-user row lock, commits its reference, then attempts removal of the
displaced object. DB failure triggers best-effort new-object removal after a
locked reference check; an unverified commit outcome retains the object rather
than risking removal of a working document. Delete commits metadata removal
before attempting Storage removal and returns `{ ok: true }`; repeated deletion
is safe. Cleanup failure does not undo a successful metadata change and emits a
sanitized warning. **No automatic retry, cleanup table, scheduler or queue exists
in V1.** Crashes, ambiguous network failures, or cleanup failures can leave
unreferenced objects requiring manual reconciliation. A deletion response means
the application reference is gone, not a guarantee of physical erasure. Old
signed URLs may work until expiry if object removal fails.

Tests (no database or Supabase network access):

```sh
npm test -- --runInBand trainee-document
```

The test script's Node VM modules flag enables the real `file-type` ESM content detector inside Jest. Tests
cover guards/HTTP multipart limits, validation (including native Node on Windows), lifecycle failures, transactional
repository calls, private bucket enforcement, and signed URLs. Live migration,
RLS, Storage policy, and multi-connection concurrency verification must be done
in an explicitly selected development environment before production rollout.
