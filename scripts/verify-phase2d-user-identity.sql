-- Phase 2D user identity cleanup verification.
-- Run after npm run migrate.
-- Expected result for every *_issues row: 0.

SELECT
  (SELECT COUNT(*) FROM "user") AS users,
  (SELECT COUNT(*) FROM user_roles) AS user_roles,
  (SELECT COUNT(*) FROM attendee) AS attendee,
  (SELECT COUNT(*) FROM event_pairing) AS event_pairing,
  (SELECT COUNT(*) FROM mentor_assignment) AS mentor_assignment,
  (SELECT COUNT(*) FROM volunteer_activity) AS volunteer_activity;

SELECT COUNT(*) AS user_id_type_issues
FROM (VALUES ('user', 'id', 'uuid')) AS expected(table_name, column_name, udt_name)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = expected.table_name
 AND c.column_name = expected.column_name
WHERE c.column_name IS NULL
   OR c.udt_name <> expected.udt_name;

SELECT COUNT(*) AS app_facing_user_fk_type_issues
FROM (
  VALUES
    ('user_roles', 'userId', 'uuid'),
    ('attendee', 'userId', 'uuid'),
    ('attendee', 'checked_in_by', 'uuid'),
    ('event_pairing', 'mentorId', 'uuid'),
    ('event_pairing', 'traineeId', 'uuid'),
    ('mentor_assignment', 'mentorId', 'uuid'),
    ('mentor_assignment', 'traineeId', 'uuid'),
    ('volunteer_activity', 'volunteer_id', 'uuid'),
    ('volunteer_activity', 'trainee_id', 'uuid')
) AS expected(table_name, column_name, udt_name)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = expected.table_name
 AND c.column_name = expected.column_name
WHERE c.column_name IS NULL
   OR c.udt_name <> expected.udt_name;

SELECT COUNT(*) AS legacy_raw_column_issues
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'user',
    'user_roles',
    'attendee',
    'event_pairing',
    'mentor_assignment',
    'volunteer_activity'
  )
  AND (column_name LIKE 'legacy_%' OR column_name LIKE 'legacy%');

SELECT COUNT(*) AS removed_shadow_column_issues
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'user',
    'user_roles',
    'attendee',
    'event_pairing',
    'mentor_assignment',
    'volunteer_activity'
  )
  AND column_name IN (
    'uuid_id',
    'user_uuid',
    'checked_in_by_uuid',
    'mentor_uuid',
    'trainee_uuid',
    'volunteer_uuid'
  );

SELECT COUNT(*) AS national_id_hash_column_issues
FROM (VALUES ('user', 'national_id_hash', 'varchar')) AS expected(table_name, column_name, udt_name)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = expected.table_name
 AND c.column_name = expected.column_name
WHERE c.column_name IS NULL
   OR c.udt_name <> expected.udt_name;

SELECT COUNT(*) AS national_id_last4_column_issues
FROM (VALUES ('user', 'national_id_last4', 'varchar')) AS expected(table_name, column_name, udt_name)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = expected.table_name
 AND c.column_name = expected.column_name
WHERE c.column_name IS NULL
   OR c.udt_name <> expected.udt_name;

SELECT COUNT(*) AS national_id_encrypted_column_issues
FROM (VALUES ('user', 'national_id_encrypted', 'text')) AS expected(table_name, column_name, udt_name)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = expected.table_name
 AND c.column_name = expected.column_name
WHERE c.column_name IS NULL
   OR c.udt_name <> expected.udt_name;

SELECT COUNT(*) AS national_id_hash_population_issues
FROM "user"
WHERE national_id_hash IS NULL;

SELECT COUNT(*) AS national_id_last4_population_issues
FROM "user"
WHERE national_id_last4 IS NULL;

SELECT COUNT(*) AS national_id_encrypted_population_issues
FROM "user"
WHERE national_id_encrypted IS NULL;

SELECT COUNT(*) AS duplicate_user_id_issues
FROM (
  SELECT id
  FROM "user"
  GROUP BY id
  HAVING COUNT(*) > 1
) duplicates;

SELECT COUNT(*) AS user_roles_reference_issues
FROM user_roles ur
LEFT JOIN "user" u ON ur."userId" = u.id
WHERE u.id IS NULL;

SELECT COUNT(*) AS attendee_user_reference_issues
FROM attendee a
LEFT JOIN "user" u ON a."userId" = u.id
WHERE u.id IS NULL;

SELECT COUNT(*) AS attendee_checked_in_by_reference_issues
FROM attendee a
LEFT JOIN "user" u ON a.checked_in_by = u.id
WHERE a.checked_in_by IS NOT NULL
  AND u.id IS NULL;

SELECT COUNT(*) AS event_pairing_mentor_reference_issues
FROM event_pairing ep
LEFT JOIN "user" u ON ep."mentorId" = u.id
WHERE u.id IS NULL;

SELECT COUNT(*) AS event_pairing_trainee_reference_issues
FROM event_pairing ep
LEFT JOIN "user" u ON ep."traineeId" = u.id
WHERE u.id IS NULL;

SELECT COUNT(*) AS mentor_assignment_mentor_reference_issues
FROM mentor_assignment ma
LEFT JOIN "user" u ON ma."mentorId" = u.id
WHERE u.id IS NULL;

SELECT COUNT(*) AS mentor_assignment_trainee_reference_issues
FROM mentor_assignment ma
LEFT JOIN "user" u ON ma."traineeId" = u.id
WHERE u.id IS NULL;

SELECT COUNT(*) AS volunteer_activity_volunteer_reference_issues
FROM volunteer_activity va
LEFT JOIN "user" u ON va.volunteer_id = u.id
WHERE u.id IS NULL;

SELECT COUNT(*) AS volunteer_activity_trainee_reference_issues
FROM volunteer_activity va
LEFT JOIN "user" u ON va.trainee_id = u.id
WHERE u.id IS NULL;

SELECT COUNT(*) AS obsolete_phase2d_index_issues
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname = 'idx_user_legacy_national_id_unique';

SELECT table_name, column_name, data_type, udt_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'user',
    'user_roles',
    'attendee',
    'event_pairing',
    'mentor_assignment',
    'volunteer_activity'
  )
  AND column_name IN (
    'id',
    'national_id_hash',
    'national_id_last4',
    'national_id_encrypted',
    'userId',
    'checked_in_by',
    'mentorId',
    'traineeId',
    'volunteer_id',
    'trainee_id'
  )
ORDER BY table_name, column_name;

SELECT
  c.conrelid::regclass::text AS table_name,
  c.conname AS constraint_name,
  c.contype AS constraint_type,
  pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
WHERE c.conrelid::regclass::text IN (
  '"user"',
  'user_roles',
  'attendee',
  'event_pairing',
  'mentor_assignment',
  'volunteer_activity'
)
  AND c.contype IN ('p', 'f', 'u')
ORDER BY c.conrelid::regclass::text, c.contype, c.conname;
