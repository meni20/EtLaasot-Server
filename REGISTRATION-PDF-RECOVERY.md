# Existing DEV registration PDF recovery — 2026-10-22

## Root cause

The form submission succeeded and committed its immutable version, medical reference and Parent 1 signature. Documents rejected the subsequent rendering request with **HTTP 400 / INVALID_REQUEST**, specifically `parents.parent1.phone` and `emergencyContact.phone`.

The Client and Server accept phone strings matching `^[+\d() -]{5,30}$`. The Documents DTO instead required a leading digit/plus and at least seven characters. The saved submission contained six- and five-digit values that the actual registration form had accepted. Consequently rendering stopped before PDF generation and Storage upload. Neither a Chromium failure nor a Storage permission problem caused this incident.

The original generation catch block suppressed the downstream cause. Historical database audit events recorded `PDF_FAILED` without the validation reason, and the user's terminal history was not available through the app terminal tool. The exact cause above was reproduced from the saved immutable version in memory against the actual running Documents endpoint, which returned the two safe field paths. No phone values, personal information, signatures or credentials were logged during diagnosis.

## Fix

- Documents now accepts exactly the registration form's phone text format. This preserves previously accepted submitted values; no padding, invented digits or changes to signed data are performed. Invalid character sets and out-of-range lengths remain rejected. Internal authentication remains unchanged.
- Server generation failures now record an allowlisted processing stage, optional Documents HTTP status and sanitized schema field paths in local logs and renewal failure audit metadata. Request bodies, response bodies, provider messages and credential/medical values remain excluded.
- Added regression tests for five-/six-digit and formatted phone values, rejected phone values and diagnostic redaction.

Files: Documents `src/documents/dto/render-request.dto.ts`, `test/registration-integration.test.ts`; Server `src/modules/parent-registration/registration-integration.service.ts`, `src/modules/parent-registration/registration-integration.spec.ts`.

## Recovery and verification

After rebuilding and restarting only the verified local Server/Documents processes, the existing submission was retried through the normal authenticated manager workflow. It did not require a trainee resubmission. The user completed the manager approval; the approved state was independently verified in Supabase DEV and in the authenticated manager UI.

- Existing form is **APPROVED**, PDF status **READY**.
- Exactly **one submitted version**, **one signature asset**, **one medical asset** and **one PDF** remain associated with the submission. The PDF references that original version. No new form version or signatures were created.
- Audit sequence: individual renewal request → submitted → PDF failed → PDF generated → approved.
- The PDF is stored in the existing private DEV bucket. A fresh download matched its recorded SHA-256 and byte length.
- The authorized manager's actual private PDF download control was exercised successfully. No public object URL or unauthenticated access was enabled.
- The recovered PDF was parsed as three A4 pages with Hebrew text, footer details and the supplied signature. All three rendered pages were visually inspected. The QA copy remains in the protected ignored `.tmp/phase5-local` directory; no personal document is added to Git.
- Documents build and **21 unit/HTTP tests** passed; focused Server generation/lifecycle tests passed. The subsequent combined Server regression run passed **49 suites / 350 tests**.

Only Supabase DEV was used. No Production, migrations, Storage policies, encryption keys, commits, pushes or deployments were changed. The original submission/evidence was preserved; normal manager approval applied the existing approved-profile update rules.
