const { createDecipheriv } = require('crypto');

const NATIONAL_ID_ENCRYPTION_KEY_ENV = 'NATIONAL_ID_ENCRYPTION_KEY';
const NATIONAL_ID_ENCRYPTION_VERSION = 'v1';
const AES_256_KEY_LENGTH_BYTES = 32;
const AES_GCM_IV_LENGTH_BYTES = 12;
const AES_GCM_AUTH_TAG_LENGTH_BYTES = 16;

const TARGET_TABLES = [
  'user',
  'user_roles',
  'attendee',
  'event_pairing',
  'mentor_assignment',
  'volunteer_activity',
];

const EXPECTED_LEGACY_COLUMNS = [
  ['user', 'legacy_national_id'],
  ['user_roles', 'legacy_userId'],
  ['attendee', 'legacy_userId'],
  ['attendee', 'legacy_checked_in_by'],
  ['event_pairing', 'legacy_mentorId'],
  ['event_pairing', 'legacy_traineeId'],
  ['mentor_assignment', 'legacy_mentorId'],
  ['mentor_assignment', 'legacy_traineeId'],
  ['volunteer_activity', 'legacy_volunteer_id'],
  ['volunteer_activity', 'legacy_trainee_id'],
];

const APP_FACING_UUID_COLUMNS = [
  ['user', 'id'],
  ['user_roles', 'userId'],
  ['attendee', 'userId'],
  ['attendee', 'checked_in_by'],
  ['event_pairing', 'mentorId'],
  ['event_pairing', 'traineeId'],
  ['mentor_assignment', 'mentorId'],
  ['mentor_assignment', 'traineeId'],
  ['volunteer_activity', 'volunteer_id'],
  ['volunteer_activity', 'trainee_id'],
];

const REMOVED_SHADOW_COLUMNS = [
  ['user', 'uuid_id'],
  ['user_roles', 'user_uuid'],
  ['attendee', 'user_uuid'],
  ['attendee', 'checked_in_by_uuid'],
  ['event_pairing', 'mentor_uuid'],
  ['event_pairing', 'trainee_uuid'],
  ['mentor_assignment', 'mentor_uuid'],
  ['mentor_assignment', 'trainee_uuid'],
  ['volunteer_activity', 'volunteer_uuid'],
  ['volunteer_activity', 'trainee_uuid'],
];

const REQUIRED_NATIONAL_ID_COLUMNS = [
  ['user', 'national_id_hash', 'varchar'],
  ['user', 'national_id_last4', 'varchar'],
  ['user', 'national_id_encrypted', 'text'],
];

const REQUIRED_CONSTRAINTS = [
  ['user', 'user_pkey'],
  ['user_roles', 'user_roles_pkey'],
  ['user_roles', 'user_roles_userId_fkey'],
  ['attendee', 'attendee_userId_fkey'],
  ['attendee', 'attendee_checked_in_by_fkey'],
  ['event_pairing', 'event_pairing_mentorId_fkey'],
  ['event_pairing', 'event_pairing_traineeId_fkey'],
  ['mentor_assignment', 'mentor_assignment_mentorId_fkey'],
  ['mentor_assignment', 'mentor_assignment_traineeId_fkey'],
  ['volunteer_activity', 'volunteer_activity_volunteer_id_fkey'],
  ['volunteer_activity', 'volunteer_activity_trainee_id_fkey'],
];

function regclassName(tableName) {
  return tableName === 'user' ? '"user"' : tableName;
}

function decodeEncryptionKey(rawKey) {
  const trimmedKey = rawKey.trim();
  const hexKeyPattern = /^[0-9a-fA-F]{64}$/;
  const key = hexKeyPattern.test(trimmedKey)
    ? Buffer.from(trimmedKey, 'hex')
    : Buffer.from(trimmedKey, 'base64');

  if (key.length !== AES_256_KEY_LENGTH_BYTES) {
    throw new Error(
      `${NATIONAL_ID_ENCRYPTION_KEY_ENV} must be a 32-byte key encoded as base64 or 64-character hex`,
    );
  }

  return key;
}

function decryptNationalId(encryptedNationalId, key) {
  const [version, ivValue, encryptedValue, authTagValue, ...extraParts] =
    encryptedNationalId.split(':');

  if (
    version !== NATIONAL_ID_ENCRYPTION_VERSION ||
    !ivValue ||
    !encryptedValue ||
    !authTagValue ||
    extraParts.length
  ) {
    throw new Error('Invalid encrypted national ID format');
  }

  const iv = Buffer.from(ivValue, 'base64');
  const encrypted = Buffer.from(encryptedValue, 'base64');
  const authTag = Buffer.from(authTagValue, 'base64');

  if (iv.length !== AES_GCM_IV_LENGTH_BYTES) {
    throw new Error('Invalid encrypted national ID IV length');
  }

  if (authTag.length !== AES_GCM_AUTH_TAG_LENGTH_BYTES) {
    throw new Error('Invalid encrypted national ID auth tag length');
  }

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    'utf8',
  );
}

async function getTableCounts(client) {
  const counts = {};

  for (const tableName of TARGET_TABLES) {
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS count FROM ${regclassName(tableName)}`,
    );
    counts[tableName] = rows[0].count;
  }

  return counts;
}

function assertCountsUnchanged(beforeCounts, afterCounts) {
  for (const [tableName, beforeCount] of Object.entries(beforeCounts)) {
    const afterCount = afterCounts[tableName];

    if (beforeCount !== afterCount) {
      throw new Error(
        `Phase 2D cleanup changed row count for ${tableName}: before=${beforeCount}, after=${afterCount}`,
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
    throw new Error(`Unexpected column remains: ${tableName}.${columnName}`);
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

async function assertIndexMissing(client, indexName) {
  const { rowCount } = await client.query(
    `
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = $1
    `,
    [indexName],
  );

  if (rowCount) {
    throw new Error(`Unexpected obsolete index remains: ${indexName}`);
  }
}

async function assertConstraintExists(client, tableName, constraintName) {
  const { rowCount } = await client.query(
    `
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = $1::regclass
        AND conname = $2
    `,
    [regclassName(tableName), constraintName],
  );

  if (!rowCount) {
    throw new Error(`Missing required constraint ${tableName}.${constraintName}`);
  }
}

async function assertRequiredColumns(client) {
  for (const [tableName, columnName] of APP_FACING_UUID_COLUMNS) {
    await assertColumnType(client, tableName, columnName, 'uuid');
  }

  for (const [tableName, columnName, udtName] of REQUIRED_NATIONAL_ID_COLUMNS) {
    await assertColumnType(client, tableName, columnName, udtName);
  }

  for (const [tableName, columnName] of REMOVED_SHADOW_COLUMNS) {
    await assertColumnMissing(client, tableName, columnName);
  }
}

async function assertKnownLegacyColumnsOnly(client) {
  const expected = new Set(
    EXPECTED_LEGACY_COLUMNS.map(
      ([tableName, columnName]) => `${tableName}.${columnName}`,
    ),
  );

  const { rows } = await client.query(
    `
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
        AND (column_name LIKE 'legacy_%' OR column_name LIKE 'legacy%')
      ORDER BY table_name, column_name
    `,
    [TARGET_TABLES],
  );

  const unknownLegacyColumns = rows
    .map((row) => `${row.table_name}.${row.column_name}`)
    .filter((column) => !expected.has(column));

  if (unknownLegacyColumns.length) {
    throw new Error(
      `Unexpected legacy columns require manual review before Phase 2D cleanup: ${unknownLegacyColumns.join(', ')}`,
    );
  }
}

async function hasAnyExpectedLegacyColumn(client) {
  for (const [tableName, columnName] of EXPECTED_LEGACY_COLUMNS) {
    if (await columnExists(client, tableName, columnName)) {
      return true;
    }
  }

  return false;
}

async function assertNoLegacyColumns(client) {
  const { rows } = await client.query(
    `
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
        AND (column_name LIKE 'legacy_%' OR column_name LIKE 'legacy%')
      ORDER BY table_name, column_name
    `,
    [TARGET_TABLES],
  );

  if (rows.length) {
    throw new Error(
      `Legacy columns remain after Phase 2D cleanup: ${rows
        .map((row) => `${row.table_name}.${row.column_name}`)
        .join(', ')}`,
    );
  }
}

async function assertNationalIdMetadataPopulated(client) {
  await assertZero(
    client,
    'Phase 2D precondition failed: users missing national ID hash',
    'SELECT COUNT(*) FROM "user" WHERE national_id_hash IS NULL',
  );

  await assertZero(
    client,
    'Phase 2D precondition failed: users missing national ID last4',
    'SELECT COUNT(*) FROM "user" WHERE national_id_last4 IS NULL',
  );

  await assertZero(
    client,
    'Phase 2D precondition failed: users missing encrypted national ID',
    'SELECT COUNT(*) FROM "user" WHERE national_id_encrypted IS NULL',
  );
}

async function assertEncryptedNationalIdsDecryptable(client, encryptionKey) {
  const { rows } = await client.query(`
    SELECT id, national_id_last4, national_id_encrypted
    FROM "user"
    WHERE national_id_encrypted IS NOT NULL
  `);

  const failedUserIds = [];

  for (const row of rows) {
    try {
      const nationalId = decryptNationalId(row.national_id_encrypted, encryptionKey);

      if (!/^\d{9}$/.test(nationalId)) {
        failedUserIds.push(row.id);
        continue;
      }

      if (row.national_id_last4 && nationalId.slice(-4) !== row.national_id_last4) {
        failedUserIds.push(row.id);
      }
    } catch {
      failedUserIds.push(row.id);
    }
  }

  if (failedUserIds.length) {
    throw new Error(
      `Phase 2D precondition failed: encrypted national IDs are not decryptable for ${failedUserIds.length} users; first user id ${failedUserIds[0]}`,
    );
  }
}

async function assertReferenceIntegrity(client) {
  await assertZero(
    client,
    'Phase 2D precondition failed: duplicate user ids',
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
    'Phase 2D precondition failed: broken user_roles references',
    `
      SELECT COUNT(*)
      FROM user_roles ur
      LEFT JOIN "user" u ON ur."userId" = u.id
      WHERE u.id IS NULL
    `,
  );

  await assertZero(
    client,
    'Phase 2D precondition failed: broken attendee.userId references',
    `
      SELECT COUNT(*)
      FROM attendee a
      LEFT JOIN "user" u ON a."userId" = u.id
      WHERE u.id IS NULL
    `,
  );

  await assertZero(
    client,
    'Phase 2D precondition failed: broken attendee.checked_in_by references',
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
    'Phase 2D precondition failed: broken event_pairing mentor references',
    `
      SELECT COUNT(*)
      FROM event_pairing ep
      LEFT JOIN "user" u ON ep."mentorId" = u.id
      WHERE u.id IS NULL
    `,
  );

  await assertZero(
    client,
    'Phase 2D precondition failed: broken event_pairing trainee references',
    `
      SELECT COUNT(*)
      FROM event_pairing ep
      LEFT JOIN "user" u ON ep."traineeId" = u.id
      WHERE u.id IS NULL
    `,
  );

  await assertZero(
    client,
    'Phase 2D precondition failed: broken mentor_assignment mentor references',
    `
      SELECT COUNT(*)
      FROM mentor_assignment ma
      LEFT JOIN "user" u ON ma."mentorId" = u.id
      WHERE u.id IS NULL
    `,
  );

  await assertZero(
    client,
    'Phase 2D precondition failed: broken mentor_assignment trainee references',
    `
      SELECT COUNT(*)
      FROM mentor_assignment ma
      LEFT JOIN "user" u ON ma."traineeId" = u.id
      WHERE u.id IS NULL
    `,
  );

  await assertZero(
    client,
    'Phase 2D precondition failed: broken volunteer_activity volunteer references',
    `
      SELECT COUNT(*)
      FROM volunteer_activity va
      LEFT JOIN "user" u ON va.volunteer_id = u.id
      WHERE u.id IS NULL
    `,
  );

  await assertZero(
    client,
    'Phase 2D precondition failed: broken volunteer_activity trainee references',
    `
      SELECT COUNT(*)
      FROM volunteer_activity va
      LEFT JOIN "user" u ON va.trainee_id = u.id
      WHERE u.id IS NULL
    `,
  );
}

async function assertRequiredConstraints(client) {
  for (const [tableName, constraintName] of REQUIRED_CONSTRAINTS) {
    await assertConstraintExists(client, tableName, constraintName);
  }
}

async function assertPhase2DPreconditions(client, encryptionKey) {
  await assertRequiredColumns(client);
  await assertKnownLegacyColumnsOnly(client);
  await assertNationalIdMetadataPopulated(client);
  if (await hasAnyExpectedLegacyColumn(client)) {
    await assertEncryptedNationalIdsDecryptable(client, encryptionKey);
  }
  await assertReferenceIntegrity(client);
  await assertRequiredConstraints(client);
}

async function dropLegacyColumns(client) {
  await client.query('DROP INDEX IF EXISTS idx_user_legacy_national_id_unique');

  await client.query(`
    ALTER TABLE "user" DROP COLUMN IF EXISTS legacy_national_id;
    ALTER TABLE user_roles DROP COLUMN IF EXISTS "legacy_userId";
    ALTER TABLE attendee DROP COLUMN IF EXISTS "legacy_userId";
    ALTER TABLE attendee DROP COLUMN IF EXISTS legacy_checked_in_by;
    ALTER TABLE event_pairing DROP COLUMN IF EXISTS "legacy_mentorId";
    ALTER TABLE event_pairing DROP COLUMN IF EXISTS "legacy_traineeId";
    ALTER TABLE mentor_assignment DROP COLUMN IF EXISTS "legacy_mentorId";
    ALTER TABLE mentor_assignment DROP COLUMN IF EXISTS "legacy_traineeId";
    ALTER TABLE volunteer_activity DROP COLUMN IF EXISTS legacy_volunteer_id;
    ALTER TABLE volunteer_activity DROP COLUMN IF EXISTS legacy_trainee_id;
  `);
}

async function verifyPhase2DCleanup(client) {
  await assertRequiredColumns(client);
  await assertNationalIdMetadataPopulated(client);
  await assertReferenceIntegrity(client);
  await assertRequiredConstraints(client);
  await assertNoLegacyColumns(client);
  await assertIndexMissing(client, 'idx_user_legacy_national_id_unique');
  await assertColumnExists(client, 'user', 'national_id_hash');
  await assertColumnExists(client, 'user', 'national_id_last4');
  await assertColumnExists(client, 'user', 'national_id_encrypted');
}

exports.up = async ({ client, getRequiredEnv }) => {
  const encryptionKey = decodeEncryptionKey(
    getRequiredEnv(NATIONAL_ID_ENCRYPTION_KEY_ENV),
  );
  const beforeCounts = await getTableCounts(client);

  await assertPhase2DPreconditions(client, encryptionKey);
  await dropLegacyColumns(client);
  await verifyPhase2DCleanup(client);

  const afterCounts = await getTableCounts(client);
  assertCountsUnchanged(beforeCounts, afterCounts);
};
