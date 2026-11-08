# DEV test-draft cleanup candidates — read-only report

Inspection date: 2026-11-08 (Asia/Jerusalem).
Target verified through Supabase: **EtLaasot-dev**, `vlysppqfozfiwcmsyban`.
Queries used explicit READ ONLY transactions. No personal form data, national IDs,
emails, passwords, hashes, documents or object contents were exported.

Eleven test drafts are potential cleanup candidates. At inspection all were DRAFT,
had no provisioned user and no user sharing their identity. Each had zero submitted
versions, zero evidence rows, zero Storage objects under its application prefix,
zero onboarding deliveries and zero deletion jobs. None had deletion requested.
They still have CREATED/other history events, which have NOT been changed.

| Application UUID | Type | Step | History events |
| --- | --- | ---: | ---: |
| c7b324c3-abc8-478b-9ddc-5afaab18c470 | TRAINEE | 1 | 1 |
| e01a5774-0c11-4684-9b10-e32d85657e41 | TRAINEE | 1 | 1 |
| 5427b812-0d43-4f44-84ce-70ee4538f65a | TRAINEE | 1 | 2 |
| 1be8b9e7-08f4-4428-abed-34558befbb1b | TRAINEE | 1 | 1 |
| 22d07e10-e734-4fd7-856c-5e3bda274709 | TRAINEE | 5 | 1 |
| 547eb87a-c85f-48d4-a0ed-0ecdd65f2c7e | TRAINEE | 1 | 2 |
| b1b9d826-330e-48df-9df8-a18138018dd6 | TRAINEE | 1 | 2 |
| 8838ff38-8eec-44a9-af29-037199773637 | TRAINEE | 1 | 1 |
| bfed4b08-2204-4b6c-b67d-8bb24026b9c0 | TRAINEE | 1 | 1 |
| 4e872ff8-d005-4405-998e-18104d620210 | VOLUNTEER | 2 | 1 |
| 4a1cdf09-2526-4d0e-a5d5-29091fbc3747 | TRAINEE | 1 | 1 |

This is an eligibility snapshot, not deletion approval. Some drafts are recent
and may be in active use. Before any separately approved cleanup, recheck their
state, credentials, all references and Storage prefix, and use the existing
audited server deletion eligibility workflow. Do not delete history separately.
Approved applications, submitted/pending/corrections/rejected applications,
regular user accounts, signatures and documents are excluded from this candidate list.

No legacy-code-to-password migration or cleanup was implemented. Existing drafts
and their recovery codes remain intact.
