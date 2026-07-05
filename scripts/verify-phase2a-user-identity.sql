-- Phase 2A user identity verification.
-- Run after npm run migrate.
-- Expected result for every *_issues row: 0.

SELECT
  (SELECT COUNT(*) FROM "user") AS users,
  (SELECT COUNT(*) FROM user_roles) AS user_roles,
  (SELECT COUNT(*) FROM attendee) AS attendee,
  (SELECT COUNT(*) FROM event_pairing) AS event_pairing,
  (SELECT COUNT(*) FROM mentor_assignment) AS mentor_assignment,
  (SELECT COUNT(*) FROM volunteer_activity) AS volunteer_activity;

SELECT COUNT(*) AS user_uuid_id_issues
FROM "user"
WHERE uuid_id IS NULL;

SELECT COUNT(*) AS user_uuid_id_duplicate_issues
FROM (
  SELECT uuid_id
  FROM "user"
  GROUP BY uuid_id
  HAVING COUNT(*) > 1
) duplicates;

SELECT COUNT(*) AS national_id_encrypted_issues
FROM "user"
WHERE national_id_encrypted IS NULL;

SELECT COUNT(*) AS user_roles_user_uuid_issues
FROM user_roles ur
LEFT JOIN "user" u ON ur."userId" = u.id
WHERE u.uuid_id IS NULL
   OR ur.user_uuid IS DISTINCT FROM u.uuid_id;

SELECT COUNT(*) AS attendee_user_uuid_issues
FROM attendee a
LEFT JOIN "user" u ON a."userId" = u.id
WHERE u.uuid_id IS NULL
   OR a.user_uuid IS DISTINCT FROM u.uuid_id;

SELECT COUNT(*) AS attendee_checked_in_by_uuid_issues
FROM attendee a
LEFT JOIN "user" u ON a.checked_in_by = u.id
WHERE a.checked_in_by IS NOT NULL
  AND (
    u.uuid_id IS NULL
    OR a.checked_in_by_uuid IS DISTINCT FROM u.uuid_id
  );

SELECT COUNT(*) AS event_pairing_mentor_uuid_issues
FROM event_pairing ep
LEFT JOIN "user" u ON ep."mentorId" = u.id
WHERE u.uuid_id IS NULL
   OR ep.mentor_uuid IS DISTINCT FROM u.uuid_id;

SELECT COUNT(*) AS event_pairing_trainee_uuid_issues
FROM event_pairing ep
LEFT JOIN "user" u ON ep."traineeId" = u.id
WHERE u.uuid_id IS NULL
   OR ep.trainee_uuid IS DISTINCT FROM u.uuid_id;

SELECT COUNT(*) AS mentor_assignment_mentor_uuid_issues
FROM mentor_assignment ma
LEFT JOIN "user" u ON ma."mentorId" = u.id
WHERE u.uuid_id IS NULL
   OR ma.mentor_uuid IS DISTINCT FROM u.uuid_id;

SELECT COUNT(*) AS mentor_assignment_trainee_uuid_issues
FROM mentor_assignment ma
LEFT JOIN "user" u ON ma."traineeId" = u.id
WHERE u.uuid_id IS NULL
   OR ma.trainee_uuid IS DISTINCT FROM u.uuid_id;

SELECT COUNT(*) AS volunteer_activity_volunteer_uuid_issues
FROM volunteer_activity va
LEFT JOIN "user" u ON va.volunteer_id = u.id
WHERE u.uuid_id IS NULL
   OR va.volunteer_uuid IS DISTINCT FROM u.uuid_id;

SELECT COUNT(*) AS volunteer_activity_trainee_uuid_issues
FROM volunteer_activity va
LEFT JOIN "user" u ON va.trainee_id = u.id
WHERE u.uuid_id IS NULL
   OR va.trainee_uuid IS DISTINCT FROM u.uuid_id;

SELECT table_name, column_name, data_type, udt_name, is_nullable
FROM information_schema.columns
WHERE table_name IN (
  'user',
  'user_roles',
  'attendee',
  'event_pairing',
  'mentor_assignment',
  'volunteer_activity'
)
AND column_name IN (
  'uuid_id',
  'national_id_encrypted',
  'user_uuid',
  'checked_in_by_uuid',
  'mentor_uuid',
  'trainee_uuid',
  'volunteer_uuid'
)
ORDER BY table_name, column_name;
