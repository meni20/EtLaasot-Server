async function getTableCounts(client) {
  const { rows } = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM "user") AS users,
      (SELECT COUNT(*)::int FROM user_roles) AS user_roles,
      (SELECT COUNT(*)::int FROM attendee) AS attendee,
      (SELECT COUNT(*)::int FROM event_pairing) AS event_pairing,
      (SELECT COUNT(*)::int FROM mentor_assignment) AS mentor_assignment,
      (SELECT COUNT(*)::int FROM volunteer_activity) AS volunteer_activity
  `);

  return rows[0];
}

function assertCountsUnchanged(beforeCounts, afterCounts) {
  for (const [tableName, beforeCount] of Object.entries(beforeCounts)) {
    const afterCount = afterCounts[tableName];

    if (beforeCount !== afterCount) {
      throw new Error(
        `Phase 2C migration changed row count for ${tableName}: before=${beforeCount}, after=${afterCount}`,
      );
    }
  }
}

async function getColumn(client, tableName, columnName) {
  const { rows } = await client.query(
    `
      SELECT column_name, data_type, udt_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
    `,
    [tableName, columnName],
  );

  return rows[0] ?? null;
}

async function columnExists(client, tableName, columnName) {
  return Boolean(await getColumn(client, tableName, columnName));
}

async function assertColumnExists(client, tableName, columnName) {
  if (!(await columnExists(client, tableName, columnName))) {
    throw new Error(`Missing required column ${tableName}.${columnName}`);
  }
}

async function assertColumnMissing(client, tableName, columnName) {
  if (await columnExists(client, tableName, columnName)) {
    throw new Error(
      `Column ${tableName}.${columnName} already exists; refusing ambiguous Phase 2C swap`,
    );
  }
}

async function assertColumnType(client, tableName, columnName, udtName) {
  const column = await getColumn(client, tableName, columnName);

  if (!column) {
    throw new Error(`Missing required column ${tableName}.${columnName}`);
  }

  if (column.udt_name !== udtName) {
    throw new Error(
      `Column ${tableName}.${columnName} has type ${column.udt_name}; expected ${udtName}`,
    );
  }
}

async function assertZero(client, label, sql) {
  const { rows } = await client.query(sql);
  const count = Number(rows[0]?.count ?? 0);

  if (count !== 0) {
    throw new Error(`${label}: ${count}`);
  }
}

async function addConstraintIfMissing(client, tableName, constraintName, sql) {
  const { rowCount } = await client.query(
    `
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = $1::regclass
        AND conname = $2
    `,
    [tableName, constraintName],
  );

  if (!rowCount) {
    await client.query(sql);
  }
}

async function isPhase2CSwapped(client) {
  const userId = await getColumn(client, 'user', 'id');
  const hasLegacyNationalId = await columnExists(
    client,
    'user',
    'legacy_national_id',
  );
  const hasUuidId = await columnExists(client, 'user', 'uuid_id');

  return userId?.udt_name === 'uuid' && hasLegacyNationalId && !hasUuidId;
}

async function assertPreSwapColumns(client) {
  await assertColumnType(client, 'user', 'id', 'varchar');
  await assertColumnType(client, 'user', 'uuid_id', 'uuid');
  await assertColumnExists(client, 'user', 'national_id_hash');
  await assertColumnExists(client, 'user', 'national_id_last4');
  await assertColumnExists(client, 'user', 'national_id_encrypted');

  await assertColumnType(client, 'user_roles', 'userId', 'varchar');
  await assertColumnType(client, 'user_roles', 'user_uuid', 'uuid');

  await assertColumnType(client, 'attendee', 'userId', 'varchar');
  await assertColumnType(client, 'attendee', 'user_uuid', 'uuid');
  await assertColumnType(client, 'attendee', 'checked_in_by', 'varchar');
  await assertColumnType(client, 'attendee', 'checked_in_by_uuid', 'uuid');

  await assertColumnType(client, 'event_pairing', 'mentorId', 'varchar');
  await assertColumnType(client, 'event_pairing', 'mentor_uuid', 'uuid');
  await assertColumnType(client, 'event_pairing', 'traineeId', 'varchar');
  await assertColumnType(client, 'event_pairing', 'trainee_uuid', 'uuid');

  await assertColumnType(client, 'mentor_assignment', 'mentorId', 'varchar');
  await assertColumnType(client, 'mentor_assignment', 'mentor_uuid', 'uuid');
  await assertColumnType(client, 'mentor_assignment', 'traineeId', 'varchar');
  await assertColumnType(client, 'mentor_assignment', 'trainee_uuid', 'uuid');

  await assertColumnType(
    client,
    'volunteer_activity',
    'volunteer_id',
    'varchar',
  );
  await assertColumnType(
    client,
    'volunteer_activity',
    'volunteer_uuid',
    'uuid',
  );
  await assertColumnType(client, 'volunteer_activity', 'trainee_id', 'varchar');
  await assertColumnType(client, 'volunteer_activity', 'trainee_uuid', 'uuid');

  await assertColumnMissing(client, 'user', 'legacy_national_id');
  await assertColumnMissing(client, 'user_roles', 'legacy_userId');
  await assertColumnMissing(client, 'attendee', 'legacy_userId');
  await assertColumnMissing(client, 'attendee', 'legacy_checked_in_by');
  await assertColumnMissing(client, 'event_pairing', 'legacy_mentorId');
  await assertColumnMissing(client, 'event_pairing', 'legacy_traineeId');
  await assertColumnMissing(client, 'mentor_assignment', 'legacy_mentorId');
  await assertColumnMissing(client, 'mentor_assignment', 'legacy_traineeId');
  await assertColumnMissing(
    client,
    'volunteer_activity',
    'legacy_volunteer_id',
  );
  await assertColumnMissing(client, 'volunteer_activity', 'legacy_trainee_id');
}

async function verifyPhase2APreconditions(client) {
  await assertZero(
    client,
    'Phase 2C precondition failed: users without uuid_id',
    'SELECT COUNT(*) FROM "user" WHERE uuid_id IS NULL',
  );

  await assertZero(
    client,
    'Phase 2C precondition failed: duplicate uuid_id values',
    `
      SELECT COUNT(*)
      FROM (
        SELECT uuid_id
        FROM "user"
        GROUP BY uuid_id
        HAVING COUNT(*) > 1
      ) duplicates
    `,
  );

  await assertZero(
    client,
    'Phase 2C precondition failed: users without national_id_hash',
    'SELECT COUNT(*) FROM "user" WHERE national_id_hash IS NULL',
  );

  await assertZero(
    client,
    'Phase 2C precondition failed: users without national_id_last4',
    'SELECT COUNT(*) FROM "user" WHERE national_id_last4 IS NULL',
  );

  await assertZero(
    client,
    'Phase 2C precondition failed: users without national_id_encrypted',
    'SELECT COUNT(*) FROM "user" WHERE national_id_encrypted IS NULL',
  );

  await assertZero(
    client,
    'Phase 2C precondition failed: user_roles.user_uuid mismatch',
    `
      SELECT COUNT(*)
      FROM user_roles ur
      LEFT JOIN "user" u ON ur."userId" = u.id
      WHERE u.uuid_id IS NULL
         OR ur.user_uuid IS DISTINCT FROM u.uuid_id
    `,
  );

  await assertZero(
    client,
    'Phase 2C precondition failed: attendee.user_uuid mismatch',
    `
      SELECT COUNT(*)
      FROM attendee a
      LEFT JOIN "user" u ON a."userId" = u.id
      WHERE u.uuid_id IS NULL
         OR a.user_uuid IS DISTINCT FROM u.uuid_id
    `,
  );

  await assertZero(
    client,
    'Phase 2C precondition failed: attendee.checked_in_by_uuid mismatch',
    `
      SELECT COUNT(*)
      FROM attendee a
      LEFT JOIN "user" u ON a.checked_in_by = u.id
      WHERE a.checked_in_by IS NOT NULL
        AND (u.uuid_id IS NULL OR a.checked_in_by_uuid IS DISTINCT FROM u.uuid_id)
    `,
  );

  await assertZero(
    client,
    'Phase 2C precondition failed: event_pairing.mentor_uuid mismatch',
    `
      SELECT COUNT(*)
      FROM event_pairing ep
      LEFT JOIN "user" u ON ep."mentorId" = u.id
      WHERE u.uuid_id IS NULL
         OR ep.mentor_uuid IS DISTINCT FROM u.uuid_id
    `,
  );

  await assertZero(
    client,
    'Phase 2C precondition failed: event_pairing.trainee_uuid mismatch',
    `
      SELECT COUNT(*)
      FROM event_pairing ep
      LEFT JOIN "user" u ON ep."traineeId" = u.id
      WHERE u.uuid_id IS NULL
         OR ep.trainee_uuid IS DISTINCT FROM u.uuid_id
    `,
  );

  await assertZero(
    client,
    'Phase 2C precondition failed: mentor_assignment.mentor_uuid mismatch',
    `
      SELECT COUNT(*)
      FROM mentor_assignment ma
      LEFT JOIN "user" u ON ma."mentorId" = u.id
      WHERE u.uuid_id IS NULL
         OR ma.mentor_uuid IS DISTINCT FROM u.uuid_id
    `,
  );

  await assertZero(
    client,
    'Phase 2C precondition failed: mentor_assignment.trainee_uuid mismatch',
    `
      SELECT COUNT(*)
      FROM mentor_assignment ma
      LEFT JOIN "user" u ON ma."traineeId" = u.id
      WHERE u.uuid_id IS NULL
         OR ma.trainee_uuid IS DISTINCT FROM u.uuid_id
    `,
  );

  await assertZero(
    client,
    'Phase 2C precondition failed: volunteer_activity.volunteer_uuid mismatch',
    `
      SELECT COUNT(*)
      FROM volunteer_activity va
      LEFT JOIN "user" u ON va.volunteer_id = u.id
      WHERE u.uuid_id IS NULL
         OR va.volunteer_uuid IS DISTINCT FROM u.uuid_id
    `,
  );

  await assertZero(
    client,
    'Phase 2C precondition failed: volunteer_activity.trainee_uuid mismatch',
    `
      SELECT COUNT(*)
      FROM volunteer_activity va
      LEFT JOIN "user" u ON va.trainee_id = u.id
      WHERE u.uuid_id IS NULL
         OR va.trainee_uuid IS DISTINCT FROM u.uuid_id
    `,
  );
}

async function dropPhase2ATriggers(client) {
  await client.query(`
    DROP TRIGGER IF EXISTS trg_phase2a_sync_user_roles_user_uuid ON user_roles;
    DROP TRIGGER IF EXISTS trg_phase2a_sync_attendee_user_uuids ON attendee;
    DROP TRIGGER IF EXISTS trg_phase2a_sync_event_pairing_user_uuids ON event_pairing;
    DROP TRIGGER IF EXISTS trg_phase2a_sync_mentor_assignment_user_uuids ON mentor_assignment;
    DROP TRIGGER IF EXISTS trg_phase2a_sync_volunteer_activity_user_uuids ON volunteer_activity;

    DROP FUNCTION IF EXISTS phase2a_sync_user_roles_user_uuid();
    DROP FUNCTION IF EXISTS phase2a_sync_attendee_user_uuids();
    DROP FUNCTION IF EXISTS phase2a_sync_event_pairing_user_uuids();
    DROP FUNCTION IF EXISTS phase2a_sync_mentor_assignment_user_uuids();
    DROP FUNCTION IF EXISTS phase2a_sync_volunteer_activity_user_uuids();
  `);
}

async function dropUserForeignKeys(client) {
  await client.query(`
    ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS "user_roles_userId_fkey";
    ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_user_uuid_fkey;

    ALTER TABLE attendee DROP CONSTRAINT IF EXISTS "attendee_userId_fkey";
    ALTER TABLE attendee DROP CONSTRAINT IF EXISTS attendee_user_uuid_fkey;
    ALTER TABLE attendee DROP CONSTRAINT IF EXISTS attendee_checked_in_by_fkey;
    ALTER TABLE attendee DROP CONSTRAINT IF EXISTS attendee_checked_in_by_uuid_fkey;

    ALTER TABLE event_pairing DROP CONSTRAINT IF EXISTS "event_pairing_mentorId_fkey";
    ALTER TABLE event_pairing DROP CONSTRAINT IF EXISTS event_pairing_mentor_uuid_fkey;
    ALTER TABLE event_pairing DROP CONSTRAINT IF EXISTS "event_pairing_traineeId_fkey";
    ALTER TABLE event_pairing DROP CONSTRAINT IF EXISTS event_pairing_trainee_uuid_fkey;

    ALTER TABLE mentor_assignment DROP CONSTRAINT IF EXISTS "mentor_assignment_mentorId_fkey";
    ALTER TABLE mentor_assignment DROP CONSTRAINT IF EXISTS mentor_assignment_mentor_uuid_fkey;
    ALTER TABLE mentor_assignment DROP CONSTRAINT IF EXISTS "mentor_assignment_traineeId_fkey";
    ALTER TABLE mentor_assignment DROP CONSTRAINT IF EXISTS mentor_assignment_trainee_uuid_fkey;

    ALTER TABLE volunteer_activity DROP CONSTRAINT IF EXISTS volunteer_activity_volunteer_id_fkey;
    ALTER TABLE volunteer_activity DROP CONSTRAINT IF EXISTS volunteer_activity_volunteer_uuid_fkey;
    ALTER TABLE volunteer_activity DROP CONSTRAINT IF EXISTS volunteer_activity_trainee_id_fkey;
    ALTER TABLE volunteer_activity DROP CONSTRAINT IF EXISTS volunteer_activity_trainee_uuid_fkey;
  `);
}

async function dropUserIdentityIndexesAndConstraints(client) {
  await client.query(`
    DROP INDEX IF EXISTS idx_user_roles_user_uuid;

    DROP INDEX IF EXISTS attendee_event_user_active_unique;
    DROP INDEX IF EXISTS attendee_user_id_event_id;
    DROP INDEX IF EXISTS idx_attendee_user_uuid;
    DROP INDEX IF EXISTS idx_attendee_checked_in_by_uuid;

    DROP INDEX IF EXISTS event_pairing_mentor_active_unique;
    DROP INDEX IF EXISTS event_pairing_trainee_active_unique;
    DROP INDEX IF EXISTS idx_event_pairing_mentor_uuid;
    DROP INDEX IF EXISTS idx_event_pairing_trainee_uuid;

    DROP INDEX IF EXISTS mentor_assignment_active_trainee_unique;
    DROP INDEX IF EXISTS idx_mentor_assignment_mentor_uuid;
    DROP INDEX IF EXISTS idx_mentor_assignment_trainee_uuid;

    DROP INDEX IF EXISTS idx_volunteer_activity_volunteer_status;
    DROP INDEX IF EXISTS uq_volunteer_activity_active_volunteer;
    DROP INDEX IF EXISTS idx_volunteer_activity_volunteer_uuid;
    DROP INDEX IF EXISTS idx_volunteer_activity_trainee_uuid;
  `);

  await client.query(`
    ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_pkey;
    ALTER TABLE "user" DROP CONSTRAINT IF EXISTS user_uuid_id_key;
    ALTER TABLE "user" DROP CONSTRAINT IF EXISTS user_pkey;
  `);
}

async function renameColumnsForSwap(client) {
  await client.query(`
    ALTER TABLE "user" RENAME COLUMN id TO legacy_national_id;
    ALTER TABLE "user" RENAME COLUMN uuid_id TO id;

    ALTER TABLE user_roles RENAME COLUMN "userId" TO "legacy_userId";
    ALTER TABLE user_roles RENAME COLUMN user_uuid TO "userId";

    ALTER TABLE attendee RENAME COLUMN "userId" TO "legacy_userId";
    ALTER TABLE attendee RENAME COLUMN user_uuid TO "userId";
    ALTER TABLE attendee RENAME COLUMN checked_in_by TO legacy_checked_in_by;
    ALTER TABLE attendee RENAME COLUMN checked_in_by_uuid TO checked_in_by;

    ALTER TABLE event_pairing RENAME COLUMN "mentorId" TO "legacy_mentorId";
    ALTER TABLE event_pairing RENAME COLUMN mentor_uuid TO "mentorId";
    ALTER TABLE event_pairing RENAME COLUMN "traineeId" TO "legacy_traineeId";
    ALTER TABLE event_pairing RENAME COLUMN trainee_uuid TO "traineeId";

    ALTER TABLE mentor_assignment RENAME COLUMN "mentorId" TO "legacy_mentorId";
    ALTER TABLE mentor_assignment RENAME COLUMN mentor_uuid TO "mentorId";
    ALTER TABLE mentor_assignment RENAME COLUMN "traineeId" TO "legacy_traineeId";
    ALTER TABLE mentor_assignment RENAME COLUMN trainee_uuid TO "traineeId";

    ALTER TABLE volunteer_activity RENAME COLUMN volunteer_id TO legacy_volunteer_id;
    ALTER TABLE volunteer_activity RENAME COLUMN volunteer_uuid TO volunteer_id;
    ALTER TABLE volunteer_activity RENAME COLUMN trainee_id TO legacy_trainee_id;
    ALTER TABLE volunteer_activity RENAME COLUMN trainee_uuid TO trainee_id;
  `);
}

async function addFinalConstraints(client) {
  await client.query(`
    ALTER TABLE "user" ALTER COLUMN id SET DEFAULT gen_random_uuid();
    ALTER TABLE "user" ALTER COLUMN id SET NOT NULL;
    ALTER TABLE user_roles ALTER COLUMN "userId" SET NOT NULL;
  `);

  await addConstraintIfMissing(
    client,
    '"user"',
    'user_pkey',
    'ALTER TABLE "user" ADD CONSTRAINT user_pkey PRIMARY KEY (id)',
  );

  await addConstraintIfMissing(
    client,
    'user_roles',
    'user_roles_pkey',
    'ALTER TABLE user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY ("userId", "roleId")',
  );

  await addConstraintIfMissing(
    client,
    'user_roles',
    'user_roles_userId_fkey',
    'ALTER TABLE user_roles ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" (id) ON UPDATE CASCADE',
  );

  await addConstraintIfMissing(
    client,
    'attendee',
    'attendee_userId_fkey',
    'ALTER TABLE attendee ADD CONSTRAINT "attendee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" (id) ON UPDATE CASCADE ON DELETE CASCADE',
  );

  await addConstraintIfMissing(
    client,
    'attendee',
    'attendee_checked_in_by_fkey',
    'ALTER TABLE attendee ADD CONSTRAINT attendee_checked_in_by_fkey FOREIGN KEY (checked_in_by) REFERENCES "user" (id) ON UPDATE CASCADE ON DELETE SET NULL',
  );

  await addConstraintIfMissing(
    client,
    'event_pairing',
    'event_pairing_mentorId_fkey',
    'ALTER TABLE event_pairing ADD CONSTRAINT "event_pairing_mentorId_fkey" FOREIGN KEY ("mentorId") REFERENCES "user" (id) ON UPDATE CASCADE ON DELETE CASCADE',
  );

  await addConstraintIfMissing(
    client,
    'event_pairing',
    'event_pairing_traineeId_fkey',
    'ALTER TABLE event_pairing ADD CONSTRAINT "event_pairing_traineeId_fkey" FOREIGN KEY ("traineeId") REFERENCES "user" (id) ON UPDATE CASCADE ON DELETE CASCADE',
  );

  await addConstraintIfMissing(
    client,
    'mentor_assignment',
    'mentor_assignment_mentorId_fkey',
    'ALTER TABLE mentor_assignment ADD CONSTRAINT "mentor_assignment_mentorId_fkey" FOREIGN KEY ("mentorId") REFERENCES "user" (id) ON UPDATE CASCADE',
  );

  await addConstraintIfMissing(
    client,
    'mentor_assignment',
    'mentor_assignment_traineeId_fkey',
    'ALTER TABLE mentor_assignment ADD CONSTRAINT "mentor_assignment_traineeId_fkey" FOREIGN KEY ("traineeId") REFERENCES "user" (id) ON UPDATE CASCADE',
  );

  await addConstraintIfMissing(
    client,
    'volunteer_activity',
    'volunteer_activity_volunteer_id_fkey',
    'ALTER TABLE volunteer_activity ADD CONSTRAINT volunteer_activity_volunteer_id_fkey FOREIGN KEY (volunteer_id) REFERENCES "user" (id) ON UPDATE CASCADE ON DELETE CASCADE',
  );

  await addConstraintIfMissing(
    client,
    'volunteer_activity',
    'volunteer_activity_trainee_id_fkey',
    'ALTER TABLE volunteer_activity ADD CONSTRAINT volunteer_activity_trainee_id_fkey FOREIGN KEY (trainee_id) REFERENCES "user" (id) ON UPDATE CASCADE ON DELETE CASCADE',
  );
}

async function addFinalIndexes(client) {
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_legacy_national_id_unique
      ON "user" (legacy_national_id)
      WHERE legacy_national_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_user_roles_userId
      ON user_roles ("userId");

    CREATE UNIQUE INDEX IF NOT EXISTS attendee_event_user_active_unique
      ON attendee ("eventId", "userId")
      WHERE "deletedAt" IS NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS attendee_user_id_event_id
      ON attendee ("userId", "eventId");

    CREATE INDEX IF NOT EXISTS idx_attendee_userId
      ON attendee ("userId");

    CREATE INDEX IF NOT EXISTS idx_attendee_checked_in_by
      ON attendee (checked_in_by);

    CREATE UNIQUE INDEX IF NOT EXISTS event_pairing_mentor_active_unique
      ON event_pairing ("eventId", "mentorId")
      WHERE "deletedAt" IS NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS event_pairing_trainee_active_unique
      ON event_pairing ("eventId", "traineeId")
      WHERE "deletedAt" IS NULL;

    CREATE INDEX IF NOT EXISTS idx_event_pairing_mentorId
      ON event_pairing ("mentorId");

    CREATE INDEX IF NOT EXISTS idx_event_pairing_traineeId
      ON event_pairing ("traineeId");

    CREATE UNIQUE INDEX IF NOT EXISTS mentor_assignment_active_trainee_unique
      ON mentor_assignment ("branchId", "traineeId")
      WHERE "isActive" = true AND "deletedAt" IS NULL;

    CREATE INDEX IF NOT EXISTS idx_mentor_assignment_mentorId
      ON mentor_assignment ("mentorId");

    CREATE INDEX IF NOT EXISTS idx_mentor_assignment_traineeId
      ON mentor_assignment ("traineeId");

    CREATE INDEX IF NOT EXISTS idx_volunteer_activity_volunteer_status
      ON volunteer_activity (volunteer_id, status);

    CREATE UNIQUE INDEX IF NOT EXISTS uq_volunteer_activity_active_volunteer
      ON volunteer_activity (volunteer_id)
      WHERE status = 'ACTIVE';

    CREATE INDEX IF NOT EXISTS idx_volunteer_activity_trainee_id
      ON volunteer_activity (trainee_id);
  `);
}

async function assertFinalColumns(client) {
  await assertColumnType(client, 'user', 'id', 'uuid');
  await assertColumnType(client, 'user', 'legacy_national_id', 'varchar');
  await assertColumnMissing(client, 'user', 'uuid_id');

  await assertColumnType(client, 'user_roles', 'userId', 'uuid');
  await assertColumnType(client, 'user_roles', 'legacy_userId', 'varchar');
  await assertColumnMissing(client, 'user_roles', 'user_uuid');

  await assertColumnType(client, 'attendee', 'userId', 'uuid');
  await assertColumnType(client, 'attendee', 'legacy_userId', 'varchar');
  await assertColumnType(client, 'attendee', 'checked_in_by', 'uuid');
  await assertColumnType(client, 'attendee', 'legacy_checked_in_by', 'varchar');
  await assertColumnMissing(client, 'attendee', 'user_uuid');
  await assertColumnMissing(client, 'attendee', 'checked_in_by_uuid');

  await assertColumnType(client, 'event_pairing', 'mentorId', 'uuid');
  await assertColumnType(client, 'event_pairing', 'legacy_mentorId', 'varchar');
  await assertColumnType(client, 'event_pairing', 'traineeId', 'uuid');
  await assertColumnType(
    client,
    'event_pairing',
    'legacy_traineeId',
    'varchar',
  );
  await assertColumnMissing(client, 'event_pairing', 'mentor_uuid');
  await assertColumnMissing(client, 'event_pairing', 'trainee_uuid');

  await assertColumnType(client, 'mentor_assignment', 'mentorId', 'uuid');
  await assertColumnType(
    client,
    'mentor_assignment',
    'legacy_mentorId',
    'varchar',
  );
  await assertColumnType(client, 'mentor_assignment', 'traineeId', 'uuid');
  await assertColumnType(
    client,
    'mentor_assignment',
    'legacy_traineeId',
    'varchar',
  );
  await assertColumnMissing(client, 'mentor_assignment', 'mentor_uuid');
  await assertColumnMissing(client, 'mentor_assignment', 'trainee_uuid');

  await assertColumnType(client, 'volunteer_activity', 'volunteer_id', 'uuid');
  await assertColumnType(
    client,
    'volunteer_activity',
    'legacy_volunteer_id',
    'varchar',
  );
  await assertColumnType(client, 'volunteer_activity', 'trainee_id', 'uuid');
  await assertColumnType(
    client,
    'volunteer_activity',
    'legacy_trainee_id',
    'varchar',
  );
  await assertColumnMissing(client, 'volunteer_activity', 'volunteer_uuid');
  await assertColumnMissing(client, 'volunteer_activity', 'trainee_uuid');
}

async function verifyFinalState(client) {
  await assertFinalColumns(client);

  await assertZero(
    client,
    'Phase 2C verification failed: duplicate user ids',
    `
      SELECT COUNT(*)
      FROM (
        SELECT id
        FROM "user"
        GROUP BY id
        HAVING COUNT(*) > 1
      ) duplicates
    `,
  );

  await assertZero(
    client,
    'Phase 2C verification failed: users missing national ID metadata',
    `
      SELECT COUNT(*)
      FROM "user"
      WHERE national_id_hash IS NULL
         OR national_id_last4 IS NULL
         OR national_id_encrypted IS NULL
    `,
  );

  await assertZero(
    client,
    'Phase 2C verification failed: broken user_roles references',
    `
      SELECT COUNT(*)
      FROM user_roles ur
      LEFT JOIN "user" u ON ur."userId" = u.id
      WHERE u.id IS NULL
    `,
  );

  await assertZero(
    client,
    'Phase 2C verification failed: broken attendee.userId references',
    `
      SELECT COUNT(*)
      FROM attendee a
      LEFT JOIN "user" u ON a."userId" = u.id
      WHERE u.id IS NULL
    `,
  );

  await assertZero(
    client,
    'Phase 2C verification failed: broken attendee.checked_in_by references',
    `
      SELECT COUNT(*)
      FROM attendee a
      LEFT JOIN "user" u ON a.checked_in_by = u.id
      WHERE a.checked_in_by IS NOT NULL
        AND u.id IS NULL
    `,
  );

  await assertZero(
    client,
    'Phase 2C verification failed: broken event_pairing mentor references',
    `
      SELECT COUNT(*)
      FROM event_pairing ep
      LEFT JOIN "user" u ON ep."mentorId" = u.id
      WHERE u.id IS NULL
    `,
  );

  await assertZero(
    client,
    'Phase 2C verification failed: broken event_pairing trainee references',
    `
      SELECT COUNT(*)
      FROM event_pairing ep
      LEFT JOIN "user" u ON ep."traineeId" = u.id
      WHERE u.id IS NULL
    `,
  );

  await assertZero(
    client,
    'Phase 2C verification failed: broken mentor_assignment mentor references',
    `
      SELECT COUNT(*)
      FROM mentor_assignment ma
      LEFT JOIN "user" u ON ma."mentorId" = u.id
      WHERE u.id IS NULL
    `,
  );

  await assertZero(
    client,
    'Phase 2C verification failed: broken mentor_assignment trainee references',
    `
      SELECT COUNT(*)
      FROM mentor_assignment ma
      LEFT JOIN "user" u ON ma."traineeId" = u.id
      WHERE u.id IS NULL
    `,
  );

  await assertZero(
    client,
    'Phase 2C verification failed: broken volunteer_activity volunteer references',
    `
      SELECT COUNT(*)
      FROM volunteer_activity va
      LEFT JOIN "user" u ON va.volunteer_id = u.id
      WHERE u.id IS NULL
    `,
  );

  await assertZero(
    client,
    'Phase 2C verification failed: broken volunteer_activity trainee references',
    `
      SELECT COUNT(*)
      FROM volunteer_activity va
      LEFT JOIN "user" u ON va.trainee_id = u.id
      WHERE u.id IS NULL
    `,
  );
}

async function runSwap(client) {
  await dropPhase2ATriggers(client);
  await dropUserForeignKeys(client);
  await dropUserIdentityIndexesAndConstraints(client);
  await renameColumnsForSwap(client);
  await addFinalConstraints(client);
  await addFinalIndexes(client);
}

module.exports.up = async ({ client }) => {
  await client.query("SET LOCAL lock_timeout = '15s'");
  await client.query("SET LOCAL statement_timeout = '120s'");

  const beforeCounts = await getTableCounts(client);

  if (await isPhase2CSwapped(client)) {
    await dropPhase2ATriggers(client);
    await addFinalConstraints(client);
    await addFinalIndexes(client);
    await verifyFinalState(client);
    return;
  }

  await assertPreSwapColumns(client);
  await verifyPhase2APreconditions(client);
  await runSwap(client);
  await verifyFinalState(client);

  const afterCounts = await getTableCounts(client);
  assertCountsUnchanged(beforeCounts, afterCounts);
};
