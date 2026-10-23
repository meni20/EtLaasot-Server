// PLAN ONLY unless separately approved. Does not create DBs/roles/clusters,
// import application environments, or reuse an existing populated database.
const fs = require('node:fs'),
  path = require('node:path'),
  { randomBytes } = require('node:crypto'),
  { spawnSync } = require('node:child_process');
async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--execute') {
    console.log(
      'PLAN ONLY: separate approval and a fresh Phase 4 database in the attested 127.0.0.1:55439 sandbox are required. No connection or SQL executed.',
    );
    return;
  }
  if (process.env.PHASE4_TEST_APPROVED !== 'fresh-isolated-phase4-only')
    throw Error('Separate Phase 4 database-test approval is required');
  const safety = require('./parent-registration-test-safety.cjs');
  process.env.PHASE2_TEST_APPROVED = 'isolated-local-only';
  process.env.PHASE2_TEST_DATABASE_URL = process.env.PHASE4_TEST_DATABASE_URL;
  process.env.PHASE2_TEST_NONCE = process.env.PHASE4_TEST_NONCE;
  process.env.PHASE2_TEST_ABORT_ON_ISOLATION_FAILURE = 'true';
  const config = safety.assertTestTarget();
  if (
    !/^etlaasot_parent_registration_test_phase4_[a-z0-9_]{1,30}$/.test(
      config.database,
    )
  )
    throw Error(
      'A new Phase 4 test database name is required; do not reuse Phase 2 databases',
    );
  const Pg = safety.createAttestedPg(config.database),
    client = new Pg.Client(config),
    root = path.resolve(__dirname, '..');
  let transaction = false;
  try {
    await client.connect(); // OS + authenticated server attestation precedes ORM/schema SQL.
    const existing = await client.query(
      "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','f') LIMIT 1",
    );
    if (existing.rowCount)
      throw Error(
        'Fresh empty Phase 4 database required; existing objects will not be replaced',
      );
    const role = await client.query(
      "SELECT rolname FROM pg_roles WHERE rolname='etlaasot_app' AND NOT rolsuper AND NOT rolbypassrls AND pg_has_role(current_user,oid,'MEMBER')",
    );
    if (role.rowCount !== 1)
      throw Error(
        'Approved sandbox-only non-owner etlaasot_app role and runner membership must be prepared separately',
      );
    await client.query('BEGIN');
    transaction = true;
    // Build a synthetic fixture matching the audited DEV roles-ID convention.
    // Adjust source text before executing it; never drop/alter existing records.
    let fixture = safety.baselineSql(root);
    if (
      !fixture.includes(
        'CREATE TABLE roles (id integer PRIMARY KEY, name varchar(100));',
      ) ||
      !fixture.includes('"roleId" integer NOT NULL REFERENCES roles(id)')
    )
      throw Error('Synthetic fixture convention changed; review required');
    fixture = fixture
      .replace(
        'CREATE TABLE roles (id integer PRIMARY KEY, name varchar(100));',
        'CREATE TABLE roles (id varchar(255) PRIMARY KEY, name varchar(255));',
      )
      .replace(
        '"roleId" integer NOT NULL REFERENCES roles(id)',
        '"roleId" integer NOT NULL',
      )
      .replace('gender varchar(255)', 'gender varchar(10)');
    await client.query(fixture);
    await client.query(
      'CREATE UNIQUE INDEX phase4_user_identity_unique ON "user"(national_id_hash);',
    );
    await client.query(
      'GRANT USAGE ON SCHEMA public TO etlaasot_app; GRANT SELECT,INSERT,UPDATE,DELETE ON "user",user_roles,branch,roles TO etlaasot_app;',
    );
    for (const name of [
      '030_parent_registration.sql',
      '031_parent_applications.sql',
    ])
      await client.query(
        fs.readFileSync(path.join(root, 'migrations', name), 'utf8'),
      );
    await client.query(
      'CREATE TABLE public.phase4_test_sandbox(nonce text NOT NULL)',
    );
    await client.query(
      'INSERT INTO public.phase4_test_sandbox(nonce) VALUES($1)',
      [process.env.PHASE2_TEST_NONCE],
    );
    await client.query('COMMIT');
    transaction = false;
    console.log(
      'PASS: synthetic baseline + 030 + 031 prepared only in the new attested local Phase 4 database.',
    );
  } finally {
    if (transaction) await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  }
  const env = {};
  for (const key of [
    'PATH',
    'Path',
    'SystemRoot',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'TEMP',
    'TMP',
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
  ])
    if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, {
    NODE_ENV: 'test',
    PHASE4_TEST_APPROVED: 'fresh-isolated-phase4-only',
    PHASE2_TEST_APPROVED: 'isolated-local-only',
    PHASE2_TEST_DATABASE_URL: process.env.PHASE2_TEST_DATABASE_URL,
    PHASE2_TEST_NONCE: process.env.PHASE2_TEST_NONCE,
    PHASE2_TEST_ABORT_ON_ISOLATION_FAILURE: 'true',
    NATIONAL_ID_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    NATIONAL_ID_HASH_SECRET: randomBytes(32).toString('hex'),
    PARENT_REGISTRATION_TOKEN_PEPPER: randomBytes(32).toString('hex'),
    JWT_SECRET: randomBytes(32).toString('hex'),
    PARENT_REGISTRATION_ENABLED: 'true',
    PARENT_ADMISSION_SCHEMA_READY: 'true',
    APPLICANT_REGISTRATION_ENABLED: 'true',
    PARENT_REGISTRATION_BLOCKING_ENABLED: 'false',
    DB_SYNC: 'false',
    DB_LOGGING: 'false',
  });
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, 'node_modules/jest/bin/jest.js'),
      '--config',
      'test/parent-admission/jest-db.json',
      '--runInBand',
    ],
    { cwd: root, env, stdio: 'inherit', windowsHide: true },
  );
  console.log(
    'Phase 4 sandbox retained. No databases, roles or clusters were dropped.',
  );
  process.exitCode = result.status ?? 1;
}
main().catch((error) => {
  console.error(
    error.code === 'PHASE2_ISOLATION_FAILURE'
      ? 'STOP: isolated sandbox attestation failed.'
      : 'STOP: Phase 4 isolated test failed; credentials, SQL and bound values suppressed.',
  );
  process.exitCode = error.code === 'PHASE2_ISOLATION_FAILURE' ? 86 : 1;
});
