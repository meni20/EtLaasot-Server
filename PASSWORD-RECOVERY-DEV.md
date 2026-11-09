# Password recovery — DEV implementation (2026-11-09)

The public password flow remains disabled. Migration 041 was verified against isolated PostgreSQL 17 and applied only to Supabase DEV `vlysppqfozfiwcmsyban`. No existing application/account/session/evidence/history row changed. Production, main and Documents were not modified.

## Ownership and recovery procedure

1. The applicant/approved user requests recovery using national ID. Responses are generic and do not disclose whether the identity/mailbox/binding exists.
2. Before the first reset, an independently authenticated, authorized manager verifies the person's identity through the existing trusted branch/in-person procedure and confirms ownership of the registered mailbox. National ID or incoming email alone is not sufficient proof.
3. In the manager ownership dialog, enter the registered email that was independently confirmed. The server must match this to its own authoritative address; the API cannot change the address. A different manager is required for a manager's own account. Branchless drafts require a super administrator and can be located by ID without assigning a branch.
4. This authorization allows a link request for 30 minutes. The reset link itself is valid for 30 minutes from issuance, even if requested near the end of the authorization window. Clicking/consuming the link proves mailbox possession and permanently establishes the binding for that unchanged identity/mailbox.
5. Future requests need no additional manager verification. Email-link possession is the recovery factor; national ID remains the locator to disambiguate family members sharing an email. Each identity requires its own independent binding. Changed mailboxes require new independent verification.

No signup email verification, automatic binding of old accounts, new registration recovery codes, temporary passwords or pre-approval regular JWTs were introduced. Existing legacy recovery/manual temporary-password reset remains unchanged. Accounts without a registered email continue to require the existing manager-assisted process.

## APIs (existing password feature gate, DEV runtime restrictions)

- `POST /password-recovery/request` — `{identifier}`; generic `{ok:true}`.
- `POST /password-recovery/consume` — `{token,password,confirmation}`; no automatic login.
- `POST /password-recovery/authorize` — regular manager JWT plus `{subjectType,subjectId,email,identityVerified:true,emailConfirmed:true}`. Types USER/APPLICATION use UUIDs; IDENTITY uses national ID. The server resolves the actual identity, current status and branch/role permissions. Only masked email metadata is returned.

Public requests require the existing trusted Origin, body limits and shared PostgreSQL rate limits. All APIs stay inaccessible while `APPLICANT_PASSWORD_AUTH_ENABLED=false`. Manager controls and forgot-password UI are also behind the Client password-flow gate. Keep `APPLICATION_CREDENTIALS_SCHEMA_READY=true`; it enables the independent session-revocation check even when public signup/reset is disabled.

## Migration 041

Creates only:

- `password_recovery_bindings`: independent manager authorization, registered mailbox, revision, and first successful possession proof.
- `password_reset_challenges`: 256-bit token SHA-256 digests, subject FKs, credential fingerprint, binding revision, fixed maximum 30-minute expiry, consumption/revocation timestamps. A partial unique index permits one outstanding challenge per identity.
- `password_reset_session_revisions`: per-user revision for immediate JWT invalidation on every Server replica.

All tables have restrictive RLS and SELECT/INSERT/UPDATE solely for the server role, no browser/service-role access or DELETE grant. No existing rows, passwords, Storage policies or document/history structures are rewritten. The existing migration runner's public history contains 041.

## Security and concurrency

Tokens exist only in process memory, the email and the POST body. Links use URL fragments, which are removed from browser history; no token goes into local/session storage. No raw/encrypted token is stored in PostgreSQL or logged. Existing EmailService, approved origin configuration and DEV recipient allowlist are reused. Mail is sent after the transaction without delaying the generic response on SMTP; there is no new durable mail-token queue. If delivery is unavailable, the user may request another link (subject to rate limits); a new request revokes earlier links.

Request/consume/manager authorization use session -> application -> user -> binding -> challenge lock order, consistent with approval and applicant login. Consumption rechecks identity, status, mailbox, binding revision, current credential digest, expiry and unused state, then updates the hash, binding, challenge and session revocations atomically. A pre-approval link cannot reset the newly approved account; request a new link. Verified application bindings follow only the server-approved account association. Applicant password resets before approval transfer the new hash normally during approval.

Approved-account resets clear temporary expiry/forced-change state and increment a session revision. JWT validation checks that revision without the auth-context cache on each request. Existing JWTs without a revision are compatible with revision zero; after a reset they fail. Login rechecks the verified credential while reading the revision to avoid issuing a usable token from an old password during a concurrent reset.

## Verification

- 40 isolated real PostgreSQL tests passed, including migration preservation/RLS, first/future reset, expiry, replacement/reuse, concurrent consume, rollback, original/new password login, applicant/JWT revocation, family-email isolation, branchless authorization and real signup -> approval -> regular login. Evidence/SMTP adapters are synthetic; ORM, repositories, services and transactions are real.
- 58 focused Server HTTP/auth/JWT/component tests passed.
- 23 local browser scenarios for signup/status/reset/manager ownership passed (16 existing plus 7 reset scenarios); 5 disabled-flow/legacy cases passed.
- Client/Server builds, TypeScript and focused lint passed. Legacy branding and production-dist fixture exclusion passed.
- No unrelated full regression suite was run. No real reset email or real-user credential reset was performed during verification.

Deployment commits/status and post-release checks are recorded in the local final deployment report, outside the Git worktrees. Before public activation, perform a controlled DEV acceptance run with actual allowed mail delivery and private document/signature integration, review the manager ownership procedure, and obtain explicit flag-activation approval.
