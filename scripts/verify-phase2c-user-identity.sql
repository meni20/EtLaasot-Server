-- Phase 2C user identity verification.
-- Run after npm run migrate.
-- Expected result for every *_issues row: 0.

SELECT
  (SELECT COUNT(*) FROM "user") AS users,
  (SELECT COUNT(*) FROM user_roles) AS user_roles,
  (SELECT COUNT(*) FROM attendee) AS attendee,
  (SELECT COUNT(*) FROM event_pairing) AS event_pairing,
  (SELECT COUNT(*) FROM mentor_assignment) AS mentor_assignment,
  (SELECT COUNT(*) FROM volunteer_activity) AS volunteer_activity;

SELECT COUNT(*) AS duplicate_user_id_issues
FROM (
  SELECT id
  FROM "user"
  GROUP BY id
  HAVING COUNT(*) > 1
) duplicates;

SELECT COUNT(*) AS national_id_metadata_issues
FROM "user"
WHERE national_id_hash IS NULL
   OR national_id_last4 IS NULL
   OR national_id_encrypted IS NULL;

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
    'legacy_national_id',
    'uuid_id',
    'national_id_hash',
    'national_id_last4',
    'national_id_encrypted',
    'userId',
    'legacy_userId',
    'user_uuid',
    'checked_in_by',
    'legacy_checked_in_by',
    'checked_in_by_uuid',
    'mentorId',
    'legacy_mentorId',
    'mentor_uuid',
    'traineeId',
    'legacy_traineeId',
    'trainee_uuid',
    'volunteer_id',
    'legacy_volunteer_id',
    'volunteer_uuid',
    'trainee_id',
    'legacy_trainee_id'
  )
ORDER BY table_name, column_name;

SELECT COUNT(*) AS app_facing_user_id_type_issues
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'user' AND column_name = 'id' AND udt_name <> 'uuid')
    OR (table_name = 'user_roles' AND column_name = 'userId' AND udt_name <> 'uuid')
    OR (table_name = 'attendee' AND column_name IN ('userId', 'checked_in_by') AND udt_name <> 'uuid')
    OR (table_name = 'event_pairing' AND column_name IN ('mentorId', 'traineeId') AND udt_name <> 'uuid')
    OR (table_name = 'mentor_assignment' AND column_name IN ('mentorId', 'traineeId') AND udt_name <> 'uuid')
    OR (table_name = 'volunteer_activity' AND column_name IN ('volunteer_id', 'trainee_id') AND udt_name <> 'uuid')
  );

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

SELECT COUNT(*) AS missing_legacy_column_issues
FROM (
  VALUES
    ('user', 'legacy_national_id'),
    ('user_roles', 'legacy_userId'),
    ('attendee', 'legacy_userId'),
    ('attendee', 'legacy_checked_in_by'),
    ('event_pairing', 'legacy_mentorId'),
    ('event_pairing', 'legacy_traineeId'),
    ('mentor_assignment', 'legacy_mentorId'),
    ('mentor_assignment', 'legacy_traineeId'),
    ('volunteer_activity', 'legacy_volunteer_id'),
    ('volunteer_activity', 'legacy_trainee_id')
) AS expected(table_name, column_name)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = expected.table_name
 AND c.column_name = expected.column_name
WHERE c.column_name IS NULL;

SELECT
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS columns,
  ccu.table_name AS foreign_table,
  string_agg(ccu.column_name, ',' ORDER BY kcu.ordinal_position) AS foreign_columns,
  rc.update_rule,
  rc.delete_rule
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema = kcu.table_schema
LEFT JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name
 AND tc.table_schema = ccu.table_schema
LEFT JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name
 AND tc.constraint_schema = rc.constraint_schema
WHERE tc.table_schema = 'public'
  AND tc.table_name IN (
    'user',
    'user_roles',
    'attendee',
    'event_pairing',
    'mentor_assignment',
    'volunteer_activity'
  )
  AND tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE')
GROUP BY
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  ccu.table_name,
  rc.update_rule,
  rc.delete_rule
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;
