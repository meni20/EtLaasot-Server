const { createCipheriv, createDecipheriv, randomBytes } = require('crypto');

const NATIONAL_ID_ENCRYPTION_KEY_ENV = 'NATIONAL_ID_ENCRYPTION_KEY';
const NATIONAL_ID_ENCRYPTION_VERSION = 'v1';
const AES_256_KEY_LENGTH_BYTES = 32;
const AES_GCM_IV_LENGTH_BYTES = 12;
const AES_GCM_AUTH_TAG_LENGTH_BYTES = 16;

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

function encryptNationalId(nationalId, key) {
  const iv = randomBytes(AES_GCM_IV_LENGTH_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(nationalId, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    NATIONAL_ID_ENCRYPTION_VERSION,
    iv.toString('base64'),
    encrypted.toString('base64'),
    authTag.toString('base64'),
  ].join(':');
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
        `Phase 2A migration changed row count for ${tableName}: before=${beforeCount}, after=${afterCount}`,
      );
    }
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

async function backfillEncryptedNationalIds(client, encryptionKey) {
  const { rows } = await client.query(`
    SELECT id
    FROM "user"
    WHERE national_id_encrypted IS NULL
    ORDER BY id
  `);

  for (const row of rows) {
    const encryptedNationalId = encryptNationalId(row.id, encryptionKey);

    await client.query(
      `
        UPDATE "user"
        SET national_id_encrypted = $1
        WHERE id = $2
          AND national_id_encrypted IS NULL
      `,
      [encryptedNationalId, row.id],
    );
  }
}

async function verifyEncryptedNationalIds(client, encryptionKey) {
  const { rows } = await client.query(`
    SELECT id, national_id_encrypted
    FROM "user"
    ORDER BY id
  `);

  for (const row of rows) {
    if (!row.national_id_encrypted) {
      throw new Error('Cannot verify national ID encryption: missing value');
    }

    const decryptedNationalId = decryptNationalId(
      row.national_id_encrypted,
      encryptionKey,
    );

    if (decryptedNationalId !== row.id) {
      throw new Error(
        'Cannot verify national ID encryption: decrypted value does not match legacy user id',
      );
    }
  }
}

async function addColumns(client) {
  await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  await client.query(`
    ALTER TABLE "user"
      ADD COLUMN IF NOT EXISTS uuid_id uuid,
      ADD COLUMN IF NOT EXISTS national_id_encrypted text
  `);

  await client.query(`
    ALTER TABLE user_roles
      ADD COLUMN IF NOT EXISTS user_uuid uuid
  `);

  await client.query(`
    ALTER TABLE attendee
      ADD COLUMN IF NOT EXISTS user_uuid uuid,
      ADD COLUMN IF NOT EXISTS checked_in_by_uuid uuid
  `);

  await client.query(`
    ALTER TABLE event_pairing
      ADD COLUMN IF NOT EXISTS mentor_uuid uuid,
      ADD COLUMN IF NOT EXISTS trainee_uuid uuid
  `);

  await client.query(`
    ALTER TABLE mentor_assignment
      ADD COLUMN IF NOT EXISTS mentor_uuid uuid,
      ADD COLUMN IF NOT EXISTS trainee_uuid uuid
  `);

  await client.query(`
    ALTER TABLE volunteer_activity
      ADD COLUMN IF NOT EXISTS volunteer_uuid uuid,
      ADD COLUMN IF NOT EXISTS trainee_uuid uuid
  `);
}

async function backfillUuidColumns(client) {
  await client.query(`
    UPDATE "user"
    SET uuid_id = gen_random_uuid()
    WHERE uuid_id IS NULL
  `);

  await client.query(`
    ALTER TABLE "user"
      ALTER COLUMN uuid_id SET DEFAULT gen_random_uuid(),
      ALTER COLUMN uuid_id SET NOT NULL
  `);

  await client.query(`
    UPDATE user_roles ur
    SET user_uuid = u.uuid_id
    FROM "user" u
    WHERE ur."userId" = u.id
      AND ur.user_uuid IS NULL
  `);

  await client.query(`
    UPDATE attendee a
    SET user_uuid = u.uuid_id
    FROM "user" u
    WHERE a."userId" = u.id
      AND a.user_uuid IS NULL
  `);

  await client.query(`
    UPDATE attendee a
    SET checked_in_by_uuid = u.uuid_id
    FROM "user" u
    WHERE a.checked_in_by = u.id
      AND a.checked_in_by IS NOT NULL
      AND a.checked_in_by_uuid IS NULL
  `);

  await client.query(`
    UPDATE event_pairing ep
    SET mentor_uuid = u.uuid_id
    FROM "user" u
    WHERE ep."mentorId" = u.id
      AND ep.mentor_uuid IS NULL
  `);

  await client.query(`
    UPDATE event_pairing ep
    SET trainee_uuid = u.uuid_id
    FROM "user" u
    WHERE ep."traineeId" = u.id
      AND ep.trainee_uuid IS NULL
  `);

  await client.query(`
    UPDATE mentor_assignment ma
    SET mentor_uuid = u.uuid_id
    FROM "user" u
    WHERE ma."mentorId" = u.id
      AND ma.mentor_uuid IS NULL
  `);

  await client.query(`
    UPDATE mentor_assignment ma
    SET trainee_uuid = u.uuid_id
    FROM "user" u
    WHERE ma."traineeId" = u.id
      AND ma.trainee_uuid IS NULL
  `);

  await client.query(`
    UPDATE volunteer_activity va
    SET volunteer_uuid = u.uuid_id
    FROM "user" u
    WHERE va.volunteer_id = u.id
      AND va.volunteer_uuid IS NULL
  `);

  await client.query(`
    UPDATE volunteer_activity va
    SET trainee_uuid = u.uuid_id
    FROM "user" u
    WHERE va.trainee_id = u.id
      AND va.trainee_uuid IS NULL
  `);
}

async function addIndexes(client) {
  await addConstraintIfMissing(
    client,
    '"user"',
    'user_uuid_id_key',
    'ALTER TABLE "user" ADD CONSTRAINT user_uuid_id_key UNIQUE (uuid_id)',
  );

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_user_roles_user_uuid
      ON user_roles (user_uuid)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_attendee_user_uuid
      ON attendee (user_uuid)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_attendee_checked_in_by_uuid
      ON attendee (checked_in_by_uuid)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_event_pairing_mentor_uuid
      ON event_pairing (mentor_uuid)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_event_pairing_trainee_uuid
      ON event_pairing (trainee_uuid)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_mentor_assignment_mentor_uuid
      ON mentor_assignment (mentor_uuid)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_mentor_assignment_trainee_uuid
      ON mentor_assignment (trainee_uuid)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_volunteer_activity_volunteer_uuid
      ON volunteer_activity (volunteer_uuid)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_volunteer_activity_trainee_uuid
      ON volunteer_activity (trainee_uuid)
  `);
}

async function addForeignKeys(client) {
  await addConstraintIfMissing(
    client,
    'user_roles',
    'user_roles_user_uuid_fkey',
    'ALTER TABLE user_roles ADD CONSTRAINT user_roles_user_uuid_fkey FOREIGN KEY (user_uuid) REFERENCES "user" (uuid_id) ON UPDATE CASCADE',
  );

  await addConstraintIfMissing(
    client,
    'attendee',
    'attendee_user_uuid_fkey',
    'ALTER TABLE attendee ADD CONSTRAINT attendee_user_uuid_fkey FOREIGN KEY (user_uuid) REFERENCES "user" (uuid_id) ON UPDATE CASCADE ON DELETE CASCADE',
  );

  await addConstraintIfMissing(
    client,
    'attendee',
    'attendee_checked_in_by_uuid_fkey',
    'ALTER TABLE attendee ADD CONSTRAINT attendee_checked_in_by_uuid_fkey FOREIGN KEY (checked_in_by_uuid) REFERENCES "user" (uuid_id) ON UPDATE CASCADE ON DELETE SET NULL',
  );

  await addConstraintIfMissing(
    client,
    'event_pairing',
    'event_pairing_mentor_uuid_fkey',
    'ALTER TABLE event_pairing ADD CONSTRAINT event_pairing_mentor_uuid_fkey FOREIGN KEY (mentor_uuid) REFERENCES "user" (uuid_id) ON UPDATE CASCADE ON DELETE CASCADE',
  );

  await addConstraintIfMissing(
    client,
    'event_pairing',
    'event_pairing_trainee_uuid_fkey',
    'ALTER TABLE event_pairing ADD CONSTRAINT event_pairing_trainee_uuid_fkey FOREIGN KEY (trainee_uuid) REFERENCES "user" (uuid_id) ON UPDATE CASCADE ON DELETE CASCADE',
  );

  await addConstraintIfMissing(
    client,
    'mentor_assignment',
    'mentor_assignment_mentor_uuid_fkey',
    'ALTER TABLE mentor_assignment ADD CONSTRAINT mentor_assignment_mentor_uuid_fkey FOREIGN KEY (mentor_uuid) REFERENCES "user" (uuid_id) ON UPDATE CASCADE',
  );

  await addConstraintIfMissing(
    client,
    'mentor_assignment',
    'mentor_assignment_trainee_uuid_fkey',
    'ALTER TABLE mentor_assignment ADD CONSTRAINT mentor_assignment_trainee_uuid_fkey FOREIGN KEY (trainee_uuid) REFERENCES "user" (uuid_id) ON UPDATE CASCADE',
  );

  await addConstraintIfMissing(
    client,
    'volunteer_activity',
    'volunteer_activity_volunteer_uuid_fkey',
    'ALTER TABLE volunteer_activity ADD CONSTRAINT volunteer_activity_volunteer_uuid_fkey FOREIGN KEY (volunteer_uuid) REFERENCES "user" (uuid_id) ON UPDATE CASCADE ON DELETE CASCADE',
  );

  await addConstraintIfMissing(
    client,
    'volunteer_activity',
    'volunteer_activity_trainee_uuid_fkey',
    'ALTER TABLE volunteer_activity ADD CONSTRAINT volunteer_activity_trainee_uuid_fkey FOREIGN KEY (trainee_uuid) REFERENCES "user" (uuid_id) ON UPDATE CASCADE ON DELETE CASCADE',
  );
}

async function addSyncTriggers(client) {
  await client.query(`
    CREATE OR REPLACE FUNCTION phase2a_sync_user_roles_user_uuid()
    RETURNS trigger AS $$
    BEGIN
      IF NEW."userId" IS NULL THEN
        NEW.user_uuid := NULL;
      ELSE
        SELECT uuid_id INTO NEW.user_uuid
        FROM "user"
        WHERE id = NEW."userId";
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_phase2a_sync_user_roles_user_uuid ON user_roles;

    CREATE TRIGGER trg_phase2a_sync_user_roles_user_uuid
    BEFORE INSERT OR UPDATE OF "userId"
    ON user_roles
    FOR EACH ROW
    EXECUTE FUNCTION phase2a_sync_user_roles_user_uuid();
  `);

  await client.query(`
    CREATE OR REPLACE FUNCTION phase2a_sync_attendee_user_uuids()
    RETURNS trigger AS $$
    BEGIN
      IF NEW."userId" IS NULL THEN
        NEW.user_uuid := NULL;
      ELSE
        SELECT uuid_id INTO NEW.user_uuid
        FROM "user"
        WHERE id = NEW."userId";
      END IF;

      IF NEW.checked_in_by IS NULL THEN
        NEW.checked_in_by_uuid := NULL;
      ELSE
        SELECT uuid_id INTO NEW.checked_in_by_uuid
        FROM "user"
        WHERE id = NEW.checked_in_by;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_phase2a_sync_attendee_user_uuids ON attendee;

    CREATE TRIGGER trg_phase2a_sync_attendee_user_uuids
    BEFORE INSERT OR UPDATE OF "userId", checked_in_by
    ON attendee
    FOR EACH ROW
    EXECUTE FUNCTION phase2a_sync_attendee_user_uuids();
  `);

  await client.query(`
    CREATE OR REPLACE FUNCTION phase2a_sync_event_pairing_user_uuids()
    RETURNS trigger AS $$
    BEGIN
      IF NEW."mentorId" IS NULL THEN
        NEW.mentor_uuid := NULL;
      ELSE
        SELECT uuid_id INTO NEW.mentor_uuid
        FROM "user"
        WHERE id = NEW."mentorId";
      END IF;

      IF NEW."traineeId" IS NULL THEN
        NEW.trainee_uuid := NULL;
      ELSE
        SELECT uuid_id INTO NEW.trainee_uuid
        FROM "user"
        WHERE id = NEW."traineeId";
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_phase2a_sync_event_pairing_user_uuids ON event_pairing;

    CREATE TRIGGER trg_phase2a_sync_event_pairing_user_uuids
    BEFORE INSERT OR UPDATE OF "mentorId", "traineeId"
    ON event_pairing
    FOR EACH ROW
    EXECUTE FUNCTION phase2a_sync_event_pairing_user_uuids();
  `);

  await client.query(`
    CREATE OR REPLACE FUNCTION phase2a_sync_mentor_assignment_user_uuids()
    RETURNS trigger AS $$
    BEGIN
      IF NEW."mentorId" IS NULL THEN
        NEW.mentor_uuid := NULL;
      ELSE
        SELECT uuid_id INTO NEW.mentor_uuid
        FROM "user"
        WHERE id = NEW."mentorId";
      END IF;

      IF NEW."traineeId" IS NULL THEN
        NEW.trainee_uuid := NULL;
      ELSE
        SELECT uuid_id INTO NEW.trainee_uuid
        FROM "user"
        WHERE id = NEW."traineeId";
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_phase2a_sync_mentor_assignment_user_uuids ON mentor_assignment;

    CREATE TRIGGER trg_phase2a_sync_mentor_assignment_user_uuids
    BEFORE INSERT OR UPDATE OF "mentorId", "traineeId"
    ON mentor_assignment
    FOR EACH ROW
    EXECUTE FUNCTION phase2a_sync_mentor_assignment_user_uuids();
  `);

  await client.query(`
    CREATE OR REPLACE FUNCTION phase2a_sync_volunteer_activity_user_uuids()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.volunteer_id IS NULL THEN
        NEW.volunteer_uuid := NULL;
      ELSE
        SELECT uuid_id INTO NEW.volunteer_uuid
        FROM "user"
        WHERE id = NEW.volunteer_id;
      END IF;

      IF NEW.trainee_id IS NULL THEN
        NEW.trainee_uuid := NULL;
      ELSE
        SELECT uuid_id INTO NEW.trainee_uuid
        FROM "user"
        WHERE id = NEW.trainee_id;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_phase2a_sync_volunteer_activity_user_uuids ON volunteer_activity;

    CREATE TRIGGER trg_phase2a_sync_volunteer_activity_user_uuids
    BEFORE INSERT OR UPDATE OF volunteer_id, trainee_id
    ON volunteer_activity
    FOR EACH ROW
    EXECUTE FUNCTION phase2a_sync_volunteer_activity_user_uuids();
  `);
}

async function verifyUuidBackfill(client) {
  await assertZero(
    client,
    'Phase 2A verification failed: users without uuid_id',
    'SELECT COUNT(*) FROM "user" WHERE uuid_id IS NULL',
  );

  await assertZero(
    client,
    'Phase 2A verification failed: duplicate uuid_id values',
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
    'Phase 2A verification failed: users without national_id_encrypted',
    'SELECT COUNT(*) FROM "user" WHERE national_id_encrypted IS NULL',
  );

  await assertZero(
    client,
    'Phase 2A verification failed: user_roles.user_uuid mismatch',
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
    'Phase 2A verification failed: attendee.user_uuid mismatch',
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
    'Phase 2A verification failed: attendee.checked_in_by_uuid mismatch',
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
    'Phase 2A verification failed: event_pairing.mentor_uuid mismatch',
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
    'Phase 2A verification failed: event_pairing.trainee_uuid mismatch',
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
    'Phase 2A verification failed: mentor_assignment.mentor_uuid mismatch',
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
    'Phase 2A verification failed: mentor_assignment.trainee_uuid mismatch',
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
    'Phase 2A verification failed: volunteer_activity.volunteer_uuid mismatch',
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
    'Phase 2A verification failed: volunteer_activity.trainee_uuid mismatch',
    `
      SELECT COUNT(*)
      FROM volunteer_activity va
      LEFT JOIN "user" u ON va.trainee_id = u.id
      WHERE u.uuid_id IS NULL
         OR va.trainee_uuid IS DISTINCT FROM u.uuid_id
    `,
  );
}

module.exports.up = async ({ client, getRequiredEnv }) => {
  const encryptionKey = decodeEncryptionKey(
    getRequiredEnv(NATIONAL_ID_ENCRYPTION_KEY_ENV),
  );
  const beforeCounts = await getTableCounts(client);

  await addColumns(client);
  await backfillUuidColumns(client);
  await backfillEncryptedNationalIds(client, encryptionKey);
  await verifyEncryptedNationalIds(client, encryptionKey);
  await verifyUuidBackfill(client);
  await addIndexes(client);
  await addForeignKeys(client);
  await addSyncTriggers(client);

  const afterCounts = await getTableCounts(client);
  assertCountsUnchanged(beforeCounts, afterCounts);
};
