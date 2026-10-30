// Pure comparison regressions. No PostgreSQL client, connection, or SQL execution.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { DIRECTORY, assertServerAttestation, serverAttestationComparison } = require('./parent-registration-sandbox.cjs');
const identity = { nonce: 'a'.repeat(64), clusterName: 'phase2-offline-fixture' };
const fixture = () => ({ database: 'postgres', username: 'etlaasot_sandbox_admin', address: '127.0.0.1', port: 55439, directory: DIRECTORY, nonce: identity.nonce, cluster_name: identity.clusterName, version: 170002 });
const check = row => assertServerAttestation(row, identity, 'postgres', 'etlaasot_sandbox_admin');
test('accepts only the complete matching attestation', () => assert.doesNotThrow(() => check(fixture())));
test('identifies the original inet text representation failure precisely', () => {
  const row = { ...fixture(), address: '127.0.0.1/32' };
  assert.deepEqual(serverAttestationComparison(row, identity, 'postgres', 'etlaasot_sandbox_admin').filter(x => !x.matches), [{ field: 'address', expected: '127.0.0.1', actual: '127.0.0.1/32', matches: false }]);
  assert.throws(() => check(row), /address: expected "127\.0\.0\.1", actual "127\.0\.0\.1\/32"/);
});
for (const [key, value, field] of [
  ['database','unexpected_database','database'],
  ['username','unexpected_role','role'],
  ['address','0.0.0.0','address'],
  ['address','127.0.0.2','address'],
  ['port',5432,'port'],
  ['directory','C:\\not-the-approved-sandbox','dataDirectory'],
  ['cluster_name','unexpected-cluster','clusterName'],
  ['version',180000,'postgresVersion'],
  ['version','170002','postgresVersion'],
]) test(`rejects mismatching ${key}=${value} without bypass`, () => assert.throws(() => check({ ...fixture(), [key]: value }), error => error.code === 'PHASE2_ISOLATION_FAILURE' && error.message.includes(`${field}:`)));
test('rejects nonce mismatch while redacting both values', () => {
  const row = { ...fixture(), nonce: 'b'.repeat(64) };
  assert.throws(() => check(row), error => error.message.includes('sandboxNonce') && !error.message.includes(identity.nonce) && !error.message.includes(row.nonce));
});
test('rejects missing server evidence', () => assert.throws(() => check(null), /serverRow/));
