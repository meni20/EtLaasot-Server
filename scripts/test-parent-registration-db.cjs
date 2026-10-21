// Does not import runtime-environment.cjs, .env, AppModule, seed.ts, or migrate.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const {
  assertTestTarget,
  assertIsolatedServer,
  baselineSql,
} = require('./parent-registration-test-safety.cjs');

async function main() {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !['--execute','--provision-and-execute','--prepare-recovered-and-execute','--new-test-database-and-execute'].includes(mode)) {
    console.log(
      'PLAN ONLY: After approval, provision a fresh native local PostgreSQL instance on 127.0.0.1:55439, dedicated etlaasot_test_runner and empty etlaasot_parent_registration_test_* DB. Set PHASE2_TEST_APPROVED and PHASE2_TEST_DATABASE_URL, then pass --execute. Nothing connected or changed.',
    );
    return;
  }
  if (process.env.PHASE2_TEST_APPROVED !== 'isolated-local-only') throw new Error('Explicit isolated test approval is required');
  const sandbox = require('./parent-registration-sandbox.cjs');
  if (mode === '--provision-and-execute') await sandbox.provision();
  if (mode === '--prepare-recovered-and-execute') await sandbox.prepareRecoveredSandbox();
  if (mode === '--new-test-database-and-execute') await sandbox.newDatabase();
  Object.assign(process.env, sandbox.testEnvironment());
  const config = assertTestTarget();
  const { Client } = require('pg');
  const client = new Client(config);
  const root = path.resolve(__dirname, '..');
  const marker = process.env.PHASE2_TEST_NONCE;
  let started = false;
  try {
    sandbox.verifyOperatingSystem();
    await client.connect();
    await assertIsolatedServer(client, config.database);
    const tables = await client.query(
      "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','f') LIMIT 1",
    );
    if (tables.rowCount)
      throw new Error(
        'Test database must be empty; no existing objects will be replaced',
      );
    await client.query('BEGIN');
    started = true;
    await client.query(baselineSql(root));
    await client.query(
      fs.readFileSync(
        path.join(root, 'migrations/030_parent_registration.sql'),
        'utf8',
      ),
    );
    await client.query(
      'CREATE TABLE public.phase2_test_sandbox (nonce text NOT NULL)',
    );
    await client.query(
      'INSERT INTO public.phase2_test_sandbox(nonce) VALUES ($1)',
      [marker],
    );
    await client.query('COMMIT');
    started = false;
    console.log('PASS: synthetic baseline and migration 030 committed in the isolated sandbox.');
  } catch (error) {
    if (started) await client.query('ROLLBACK').catch(() => {});
    if (error.code === 'PHASE2_ISOLATION_FAILURE') throw error;
    throw new Error(
      `Isolated database preparation failed (code ${/^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'UNKNOWN'}); connection details and SQL data suppressed`,
    );
  } finally {
    await client.end().catch(() => {});
  }
  // New process receives no Dev/Production connection, Supabase, mail or cloud credentials.
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
    PHASE2_TEST_APPROVED: 'isolated-local-only',
    PHASE2_TEST_DATABASE_URL: process.env.PHASE2_TEST_DATABASE_URL,
    PHASE2_TEST_NONCE: marker,
    PHASE2_TEST_ABORT_ON_ISOLATION_FAILURE: 'true',
    NATIONAL_ID_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    JWT_SECRET: randomBytes(32).toString('hex'),
    PARENT_REGISTRATION_ENABLED: 'true',
    PARENT_REGISTRATION_BLOCKING_ENABLED: 'false',
  });
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, 'node_modules/jest/bin/jest.js'),
      '--config',
      'test/parent-registration/jest-db.json',
      '--runInBand',
    ],
    { cwd: root, env, stdio: 'inherit', windowsHide: true },
  );
  console.log(
    'Sandbox retained for local review. This runner never drops databases or creates roles. Use a new empty sandbox for the next run.',
  );
  process.exitCode = result.status ?? 1;
}
main().catch((error) => {
  console.error(error.code === 'PHASE2_ISOLATION_FAILURE' ? `STOP: isolation verification failed: ${error.message}` : error.message);
  process.exitCode = error.code === 'PHASE2_ISOLATION_FAILURE' ? 86 : 1;
});
