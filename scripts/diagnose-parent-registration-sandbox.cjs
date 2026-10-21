// Read-only diagnostics. No pg client, password access, SQL, start/restart, or DDL.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sandbox = require('./parent-registration-sandbox.cjs');
const identity = sandbox.verifyOperatingSystem();
const executable = 'C:\\Program Files\\PostgreSQL\\17\\bin\\postgres.exe';
const normalize = value => path.resolve(value).replace(/\\/g, '/').toLowerCase();
function configured(name) {
  const result = spawnSync(executable, ['-D', sandbox.DIRECTORY, '-C', name], { encoding: 'utf8', windowsHide: true, env: sandbox.cleanEnvironment(), timeout: 10000 });
  if (result.status !== 0) throw new Error('Read-only sandbox configuration inspection failed');
  return result.stdout.trim();
}
const configuredValues = Object.fromEntries(['data_directory','listen_addresses','port','cluster_name','phase2.sandbox_nonce','server_version_num'].map(name => [name, configured(name)]));
const results = {
  databaseConnectionsMade: false,
  osAndClusterVerification: 'PASS',
  executable,
  pid: identity.pid,
  dataDirectory: { expected: sandbox.DIRECTORY, configured: configuredValues.data_directory, matches: normalize(configuredValues.data_directory) === normalize(sandbox.DIRECTORY) },
  listenAddress: { expected: '127.0.0.1', configured: configuredValues.listen_addresses, matches: configuredValues.listen_addresses === '127.0.0.1' },
  port: { expected: sandbox.PORT, configured: Number(configuredValues.port), matches: Number(configuredValues.port) === sandbox.PORT },
  clusterName: { matches: configuredValues.cluster_name === identity.clusterName },
  sandboxNonce: { matches: configuredValues['phase2.sandbox_nonce'] === identity.nonce, length: identity.nonce.length, values: '[redacted]' },
  credentialFileAvailable: fs.existsSync(path.join(sandbox.DIRECTORY,'phase2-credentials.dpapi')),
  bootstrapDatabase: { expected: 'postgres', liveSqlVerification: 'Unavailable: bootstrap credentials were not persisted' },
  bootstrapRole: { expected: 'etlaasot_sandbox_admin', liveSqlVerification: 'Unavailable: bootstrap credentials were not persisted' },
};
console.log(JSON.stringify(results, null, 2));
// A local in-memory reproduction, NOT a query or captured server response.
const fixture = {
  database: 'postgres', username: 'etlaasot_sandbox_admin', address: '127.0.0.1/32', port: sandbox.PORT,
  directory: configuredValues.data_directory, nonce: configuredValues['phase2.sandbox_nonce'],
  cluster_name: configuredValues.cluster_name, version: Number(configuredValues.server_version_num),
};
console.log('Offline reproduction using PostgreSQL-documented inet::text formatting:');
console.log(JSON.stringify(sandbox.serverAttestationComparison(fixture, identity, 'postgres', 'etlaasot_sandbox_admin').filter(field => !field.matches)));
