const fs = require('node:fs');
const path = require('node:path');

const DATABASE_PATTERN = /^etlaasot_parent_registration_test_[a-z0-9_]{1,40}$/;
function assertTestTarget(env = process.env) {
  if (env.PHASE2_TEST_APPROVED !== 'isolated-local-only')
    throw new Error('Explicit isolated test approval is required');
  const raw = env.PHASE2_TEST_DATABASE_URL;
  if (!raw)
    throw new Error(
      'Dedicated PHASE2_TEST_DATABASE_URL is required; application DB variables are never used',
    );
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid isolated test URL');
  }
  const database = decodeURIComponent(url.pathname.slice(1));
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '55439' ||
    !DATABASE_PATTERN.test(database) ||
    decodeURIComponent(url.username) !== 'etlaasot_test_runner' ||
    !url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Test URL must use dedicated etlaasot_test_runner on 127.0.0.1:55439 and an etlaasot_parent_registration_test_* database, without URL options',
    );
  }
  return {
    host: '127.0.0.1',
    port: 55439,
    database,
    user: 'etlaasot_test_runner',
    password: decodeURIComponent(url.password),
    ssl: false,
    connectionTimeoutMillis: 3000,
    application_name: 'parent-registration-isolated-tests',
    options: '-c statement_timeout=10000 -c lock_timeout=3000',
  };
}
async function assertIsolatedServer(client, expectedDatabase) {
  const { attest, readIdentity, IsolationError } = require('./parent-registration-sandbox.cjs');
  try {
    if (process.env.PHASE2_TEST_NONCE !== readIdentity().nonce) throw new IsolationError('Expected sandbox nonce mismatch before SQL');
    return await attest(client, expectedDatabase);
  } catch (error) {
    // A failed connection attestation must stop the suite immediately, rather
    // than becoming an ordinary test rejection that Jest might continue past.
    if (process.env.PHASE2_TEST_ABORT_ON_ISOLATION_FAILURE === 'true') {
      console.error('STOP: sandbox connection attestation failed; no further tests may execute.');
      process.exit(86);
    }
    throw error;
  }
}
function baselineSql(rootDir) {
  return fs.readFileSync(
    path.join(rootDir, 'test/parent-registration/baseline.sql'),
    'utf8',
  );
}
function createAttestedPg(expectedDatabase) {
  const pg = require('pg');
  const sandbox = require('./parent-registration-sandbox.cjs');
  class AttestedClient extends pg.Client {
    connect(callback) {
      const establish = async () => {
        try { sandbox.verifyOperatingSystem(); }
        catch (error) {
          if (process.env.PHASE2_TEST_ABORT_ON_ISOLATION_FAILURE === 'true') {
            console.error('STOP: sandbox OS identity verification failed before connection.');
            process.exit(86);
          }
          throw error;
        }
        await super.connect();
        try { await assertIsolatedServer(this, expectedDatabase); }
        catch (error) { await super.end().catch(() => {}); throw error; }
      };
      // Sequelize sends SET/catalog queries inside its connect implementation,
      // before afterConnect. Attest at the pg driver boundary first.
      if (typeof callback === 'function') {
        establish().then(() => callback(null), callback);
        return;
      }
      return establish();
    }
  }
  return { ...pg, Client: AttestedClient };
}
module.exports = { assertTestTarget, assertIsolatedServer, baselineSql, createAttestedPg };
