# Welcome email and password setup — DEV rollout

Feature code is disabled by default. No shared database migration, environment change, SMTP send or manual Railway deployment was performed during implementation.

## Prerequisites

1. Apply **037_registration_welcome_email.sql** to Supabase DEV using the existing reviewed owner-level migration workflow. Do not run all historical migrations blindly. Existing migrations through 036 and the existing etlaasot_app role are prerequisites. This additive migration creates one private RLS-protected outbox/token table and credential/role-change revocation triggers; it does not rewrite existing users or registration history.
2. Configure the following Server DEV variables through the normal configuration workflow. Enable the feature only after migration and configuration are ready.

| Variable | DEV configuration |
| --- | --- |
| REGISTRATION_WELCOME_EMAIL_ENABLED | `true` to activate; default `false` |
| PUBLIC_CLIENT_ORIGIN | `https://etlaasot-client-dev-dev.up.railway.app` |
| REGISTRATION_WELCOME_EMAIL_KEY | Dedicated random 32-byte hex secret, generated/stored privately; never reuse JWT, national-ID encryption or admission pepper keys |
| REGISTRATION_EMAIL_ALLOWED_RECIPIENTS | Comma-separated exact approved test email addresses; required in DEV. No wildcard or automatic redirection. Non-allowlisted application emails are skipped. |
| SMTP_HOST / SMTP_PORT / SMTP_SECURE | Existing TLS SMTP transport configuration. Implicit TLS or required STARTTLS; plaintext SMTP is not supported. |
| SMTP_USER / SMTP_APP_PASSWORD / EMAIL_FROM | Existing sender configuration; keep credentials in the secret store |

Existing registration feature flags and Runtime/DB attestation remain required. Existing Client registration API/environment settings are reused; no new Client variable is needed. For isolated local development only, PUBLIC_CLIENT_ORIGIN can be http://localhost:5173 or :5174. Verified Production runtime requires its own key and exactly the Production Client origin; DEV origins are rejected there. Request Host/Origin headers never determine generated links. Do not configure Production in this task.

## Behavior

- Only NEW admission approvals enqueue messages. Annual renewal approval and replayed approvals do not enqueue additional mail. Account/role/application/outbox writes share the original transaction; SMTP runs after commit.
- Volunteer recipient is the reviewed volunteer email. The approval dialog explicitly displays it and states the manager's authorization confirmation. Trainee recipient is only the reviewed trainee.email, and requires a separate manager confirmation checkbox sent as the strict boolean welcomeEmailConfirmed. Parent addresses are never substituted. Missing/unconfirmed/test-blocked recipients retain manual handoff.
- The original one-time manager temporary-password display and existing password-reset action remain available. Email contains no password, national ID, medical data or registration PDF.
- Tokens have 256 bits of randomness and a 24-hour lifetime measured from approval. Hashes are used for verification. The retry-only token payload is AES-256-GCM encrypted with per-message authenticated data and is purged on SMTP acceptance, token use, revocation or expiry. Never store plaintext tokens/passwords in comments, fixtures, logs or configuration.
- A 15-second worker claims at most one due message per tick using SKIP LOCKED and a five-minute lease. Five automatic attempts use bounded exponential backoff. Expired leases recover after crashes. Manager retry is branch-authorized/rate-limited, reuses the same unexpired link and starts another bounded cycle; it does not reapprove, reprovision or rotate passwords.
- Delivery state is separate from approval: PENDING/PROCESSING, SENT (SMTP accepted), FAILED, SKIPPED, CANCELLED or EXPIRED. SENT does not prove inbox delivery. SMTP timeout after remote acceptance can cause a duplicate message; retries carry the same token and deterministic Message-ID, never a different password. SMTP cannot guarantee exactly-once delivery.
- Failed delivery with an expired/revoked link, missing/unconfirmed address, accepted delivery or an older already-approved application is not eligible for the retry action. Use the existing manager temporary-password reset/manual handoff. Correct recipient details before approval via the existing review/corrections flow.
- Setup uses /setup-password#token=...; the fragment is removed from browser history on mounting. Tokens are POSTed in a body to /onboarding/password-setup, not placed in Server URLs. No auth JWT is attached. A GET/link scanner never consumes the token. Setup uses the same password policy/Argon2id hashing, atomically marks the token consumed, clears mustChangePassword and temporary-password expiry, and directs to normal login.
- Existing manager reset still generates a temporary password and forces first-login change. Database triggers immediately revoke pending setup links after password, active/deleted state, email, branch or role changes. Password setup takes user then delivery row locks, matching credential-trigger order; competing setup submissions cannot both succeed.
- Public setup requires the configured Client Origin and existing shared admission rate limits. No public resend/account enumeration API was added. Logs contain no raw SMTP messages, full links, tokens or passwords.

## Manual DEV acceptance

1. Use synthetic applications and an allowlisted mailbox. Approve a volunteer. Confirm the account is approved, one-time manual password is still shown, and email status progresses independently. Inspect the delivered Hebrew RTL email and confirm all links point to DEV.
2. For a trainee with trainee.email, confirm the authorized-recipient checkbox and approve. Repeat with the checkbox off and with only a parent email: both must use manual handoff without emailing the parent.
3. Open the setup link in an uncached browser. Choose/confirm a valid password, then log in normally using the synthetic national ID and chosen password. Reuse the link: it must fail. Confirm no token remains in the address bar. Verify that the actual mail provider preserves the fragment when rewriting links.
4. Before using another setup link, issue a temporary password using the existing manager reset. The link must fail; temporary-password login must still require a password change. Repeat account deactivation and email-change checks on synthetic records.
5. In an isolated test environment, simulate SMTP failure. Approval/account must remain approved and unchanged. After bounded attempts, retry as the same-branch manager. Cross-branch managers must be denied. Retry must not generate a new password or link. Do not break a shared SMTP service just to simulate failure.
6. Use the isolated test harness for expiry/concurrency checks; never change the server clock or Production records. Inbox delivery/provider DNS and real browser acceptance remain manual checks, not claims established by offline tests.

## Focused verification

`npm run build` checks the Server production source. Client `npm run build` includes TypeScript.

`node scripts/test-welcome-db.cjs` creates a fresh loopback-only PostgreSQL cluster/database with synthetic fixtures, applies 037 there, runs welcome.integration.spec.ts, and stops its own cluster. It never reads application .env files or connects to DEV/Production. PostgreSQL 17 bin defaults to C:/Program Files/PostgreSQL/17/bin; override ONBOARDING_PG_BIN if necessary. Port 55447 must be free; an occupied port is a failure, never a reason to reuse that server. Temporary test files are retained outside the repository under ../.tmp.

Run offline focused suites through the existing Jest command: welcome.security.spec.ts, admission.spec.ts, volunteer.spec.ts, user.admission-provisioning.spec.ts and auth/password.util.spec.ts. No SMTP or shared database is needed for these suites.

## Operations

Retain the dedicated encryption key while unaccepted queued/failed emails remain within their lifetime. Disabling the flag stops processing and setup; it does not change existing accounts/passwords. Keep existing manual reset available during outages. Do not rotate the key as an email retry mechanism. Do not automatically replay historical approvals or backfill welcome emails. Do not log database row contents or enable Nodemailer debug/message logging.

## Implementation files

Server: `src/main.ts`; `src/modules/email/email.service.ts`; `src/modules/parent-admission/admission.controller.ts`, `admission.dto.ts`, `admission.module.ts`, `admission.service.ts`, `admission.spec.ts`, `volunteer.spec.ts`; new `welcome.controller.ts`, `welcome.service.ts`, `welcome.security.ts`, `welcome.security.spec.ts`, `welcome.integration.spec.ts` in that same directory; `migrations/037_registration_welcome_email.sql`; `scripts/test-welcome-db.cjs`; this document.

Client: `src/features/parent-admission/api.ts`, `ApplicantAdminPage.tsx`, new `PasswordSetupPage.tsx`; `src/router/Router.tsx`.

Validation: Server Nest build and Client TypeScript/Vite build passed. Focused offline approval/provisioning/password/security suites passed (70 tests, including volunteer approval replay); isolated PostgreSQL checks passed (21 tests). No real SMTP delivery, browser acceptance, shared migration or Railway verification was performed.
