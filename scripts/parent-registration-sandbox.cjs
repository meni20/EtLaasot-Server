// Windows-only provisioning/attestation for the single explicitly approved cluster.
// Never loads application configuration, touches another cluster, or prints secrets.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DIRECTORY = path.join(ROOT, '.tmp', 'parent-registration-postgres-20261020-a');
const BIN = 'C:\\Program Files\\PostgreSQL\\17\\bin';
const IDENTITY = path.join(DIRECTORY, 'phase2-identity.json');
const SECRETS = path.join(DIRECTORY, 'phase2-credentials.dpapi');
const PORT = 55439;
const ADMIN = 'etlaasot_sandbox_admin';
const ROLE = 'etlaasot_test_runner';
const DATABASE_PREFIX = 'etlaasot_parent_registration_test_20261020_a';
const PS = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const normalize = value => path.resolve(value).replace(/\\/g, '/').toLowerCase();
class IsolationError extends Error {
  constructor(message) { super(message); this.code = 'PHASE2_ISOLATION_FAILURE'; }
}
function cleanEnvironment() {
  const result = {};
  for (const key of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','TEMP','TMP','HOME','USERPROFILE','APPDATA','LOCALAPPDATA']) if (process.env[key]) result[key] = process.env[key];
  return result;
}
function ps(script, input = '') {
  const result = spawnSync(PS, ['-NoProfile','-NonInteractive','-Command', "$ErrorActionPreference='Stop'; " + script], { input, encoding: 'utf8', windowsHide: true, env: cleanEnvironment(), timeout: 20000 });
  if (result.status !== 0) throw new IsolationError('Windows sandbox verification or credential protection failed');
  return result.stdout.trim();
}
function runBinary(name, args) {
  const result = spawnSync(path.join(BIN, name), args, { encoding: 'utf8', windowsHide: true, env: cleanEnvironment(), timeout: 60000 });
  if (result.status !== 0) throw new Error(`Sandbox ${name} failed; diagnostic values suppressed`);
  return result.stdout;
}
function osSnapshot(pid = 0) {
  return JSON.parse(ps(`$listeners = @(Get-NetTCPConnection -State Listen -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess); $processInfo = $null; if (${Number(pid)} -gt 0) { $processInfo = Get-CimInstance Win32_Process -Filter 'ProcessId = ${Number(pid)}' | Select-Object ProcessId,ExecutablePath,CommandLine }; @{ listeners=$listeners; processInfo=$processInfo } | ConvertTo-Json -Depth 4 -Compress`));
}
function readIdentity() {
  const identity = JSON.parse(fs.readFileSync(IDENTITY, 'utf8'));
  if (normalize(identity.directory) !== normalize(DIRECTORY) || !/^[a-f0-9]{64}$/.test(identity.nonce) || !/^\d+$/.test(identity.systemIdentifier) || identity.port !== PORT || !Number.isInteger(identity.pid) || identity.pid < 1) throw new IsolationError('Sandbox manifest identity mismatch');
  if (normalize(fs.realpathSync(DIRECTORY)) !== normalize(DIRECTORY)) throw new IsolationError('Sandbox directory must not be redirected');
  return identity;
}
function verifyOperatingSystem(identity = readIdentity()) {
  const pidFile = fs.readFileSync(path.join(DIRECTORY, 'postmaster.pid'), 'utf8').split(/\r?\n/);
  if (Number(pidFile[0]) !== identity.pid || normalize(pidFile[1]) !== normalize(DIRECTORY) || Number(pidFile[3]) !== PORT || pidFile[5] !== '127.0.0.1') throw new IsolationError('Sandbox postmaster identity mismatch');
  const snapshot = osSnapshot(identity.pid);
  const processInfo = snapshot.processInfo;
  if (!snapshot.listeners.length || snapshot.listeners.some(x => x.LocalAddress !== '127.0.0.1' || x.OwningProcess !== identity.pid || x.LocalPort !== PORT)) throw new IsolationError('Sandbox loopback listener identity mismatch');
  if (!processInfo || normalize(processInfo.ExecutablePath || '') !== normalize(path.join(BIN, 'postgres.exe')) || !processInfo.CommandLine?.includes(DIRECTORY) && !processInfo.CommandLine?.includes(DIRECTORY.replace(/\\/g, '/'))) throw new IsolationError('Sandbox PostgreSQL executable/data-directory process identity mismatch');
  const control = runBinary('pg_controldata.exe', ['-D', DIRECTORY]);
  const systemIdentifier = control.match(/Database system identifier:\s*(\d+)/)?.[1];
  if (systemIdentifier !== identity.systemIdentifier) throw new IsolationError('Sandbox cluster system identifier mismatch');
  return identity;
}
function serverAttestationComparison(server, identity, expectedDatabase, expectedRole = ROLE) {
  if (!server) return [{ field: 'serverRow', expected: 'one attestation row', actual: 'missing', matches: false }];
  const fields = [
    { field: 'database', expected: expectedDatabase, actual: server.database },
    { field: 'role', expected: expectedRole, actual: server.username },
    { field: 'address', expected: '127.0.0.1', actual: server.address },
    { field: 'port', expected: PORT, actual: server.port },
    { field: 'dataDirectory', expected: normalize(DIRECTORY), actual: typeof server.directory === 'string' ? normalize(server.directory) : null },
    // The nonce is an attestation token. Compare it exactly, but never log its value.
    { field: 'sandboxNonce', expected: '[redacted]', actual: '[redacted]', matches: server.nonce === identity.nonce },
    { field: 'clusterName', expected: identity.clusterName, actual: server.cluster_name },
    { field: 'postgresVersion', expected: '17.x', actual: server.version, matches: Number.isInteger(server.version) && server.version >= 170000 && server.version < 180000 },
  ];
  return fields.map(field => ({ ...field, matches: field.matches ?? field.expected === field.actual }));
}
function assertServerAttestation(server, identity, expectedDatabase, expectedRole = ROLE) {
  const mismatches = serverAttestationComparison(server, identity, expectedDatabase, expectedRole).filter(field => !field.matches);
  if (mismatches.length) {
    const details = mismatches.map(({ field, expected, actual }) => `${field}: expected ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)}`).join('; ');
    throw new IsolationError(`Sandbox server attestation failed (${details})`);
  }
}
async function attest(client, expectedDatabase, expectedRole = ROLE) {
  // OS/manifest and successful SCRAM startup are checked BEFORE the first SQL.
  const identity = verifyOperatingSystem();
  const socket = client.connection?.stream;
  if (socket?.remoteAddress !== '127.0.0.1' || socket?.remotePort !== PORT || client.connectionParameters?.database !== expectedDatabase || client.connectionParameters?.user !== expectedRole) throw new IsolationError('Sandbox authenticated socket/database/role mismatch');
  // First statement is a read-only server attestation, never DDL/DML.
  // inet::text includes the netmask (/32). host(inet) returns the exact host
  // representation already required by the socket/listener/address checks.
  const result = await client.query("SELECT current_database() AS database, current_user AS username, host(inet_server_addr()) AS address, inet_server_port() AS port, current_setting('data_directory') AS directory, current_setting('phase2.sandbox_nonce') AS nonce, current_setting('cluster_name') AS cluster_name, current_setting('server_version_num')::integer AS version");
  const server = result.rows[0];
  assertServerAttestation(server, identity, expectedDatabase, expectedRole);
  return identity;
}
function writeSecrets(value) {
  const encoded = ps("Add-Type -AssemblyName System.Security; $raw=[Console]::In.ReadToEnd(); $bytes=[Text.Encoding]::UTF8.GetBytes($raw); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))", JSON.stringify(value));
  fs.writeFileSync(SECRETS, encoded, { encoding: 'utf8', mode: 0o600 });
}
function readSecrets() {
  verifyOperatingSystem();
  const decoded = ps("Add-Type -AssemblyName System.Security; $raw=[Console]::In.ReadToEnd(); $bytes=[Convert]::FromBase64String($raw); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))", fs.readFileSync(SECRETS, 'utf8'));
  return JSON.parse(decoded);
}
function pgConfig(secret, database = 'postgres', admin = false) {
  return { host: '127.0.0.1', port: PORT, database, user: admin ? ADMIN : ROLE, password: admin ? secret.adminPassword : secret.testPassword, ssl: false, connectionTimeoutMillis: 5000, options: '-c statement_timeout=10000 -c lock_timeout=3000', application_name: 'parent-registration-isolated-provisioning' };
}
async function createDatabase(secret, database) {
  if (!new RegExp(`^${DATABASE_PREFIX}(?:_r[0-9]+)?$`).test(database)) throw new IsolationError('Unexpected sandbox database name');
  verifyOperatingSystem();
  const { Client } = require('pg');
  const admin = new Client(pgConfig(secret, 'postgres', true));
  try {
    await admin.connect(); await attest(admin, 'postgres', ADMIN);
    await admin.query(`CREATE DATABASE "${database}" OWNER ${ROLE} TEMPLATE template0 ENCODING 'UTF8'`);
  } finally { await admin.end(); }
  secret.database = database; writeSecrets(secret);
}
async function provision() {
  if (process.platform !== 'win32') throw new IsolationError('Approved sandbox requires Windows');
  if (fs.existsSync(DIRECTORY)) throw new IsolationError('Fresh approved data directory already exists; refusing reuse');
  if (osSnapshot().listeners.length) throw new IsolationError('Approved sandbox port is already occupied');
  fs.mkdirSync(path.dirname(DIRECTORY), { recursive: true });
  if (normalize(fs.realpathSync(path.dirname(DIRECTORY))) !== normalize(path.dirname(DIRECTORY))) throw new IsolationError('Sandbox parent directory is redirected');
  fs.mkdirSync(DIRECTORY);
  // Current Windows user + SYSTEM only. All database files and encrypted credentials inherit this ACL.
  ps("$dir=[Console]::In.ReadToEnd(); $acl=New-Object Security.AccessControl.DirectorySecurity; $acl.SetAccessRuleProtection($true,$false); $owner=[Security.Principal.WindowsIdentity]::GetCurrent().User; $acl.SetOwner($owner); foreach($who in @($owner,(New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))) { $rule=New-Object Security.AccessControl.FileSystemAccessRule($who,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule) }; Set-Acl -LiteralPath $dir -AclObject $acl", DIRECTORY);
  const secret = { adminPassword: randomBytes(32).toString('hex'), testPassword: randomBytes(32).toString('hex'), database: DATABASE_PREFIX };
  const passwordFile = path.join(DIRECTORY, 'init-password.tmp');
  fs.writeFileSync(passwordFile, secret.adminPassword, { mode: 0o600 });
  // initdb requires an empty data directory, so pass its private password file from the parent.
  const parentPasswordFile = path.join(path.dirname(DIRECTORY), 'phase2-init-password.tmp');
  if (fs.existsSync(parentPasswordFile)) throw new IsolationError('Unexpected initial-password file already exists');
  fs.renameSync(passwordFile, parentPasswordFile);
  try {
    runBinary('initdb.exe', ['-D', DIRECTORY, '--username='+ADMIN, '--encoding=UTF8', '--locale=C', '--auth=scram-sha-256', '--pwfile='+parentPasswordFile]);
  } finally { fs.unlinkSync(parentPasswordFile); }
  const identity = { directory: DIRECTORY, port: PORT, nonce: randomBytes(32).toString('hex'), clusterName: 'phase2-'+randomBytes(12).toString('hex'), systemIdentifier: '', pid: 0 };
  identity.systemIdentifier = runBinary('pg_controldata.exe', ['-D', DIRECTORY]).match(/Database system identifier:\s*(\d+)/)?.[1] ?? '';
  fs.appendFileSync(path.join(DIRECTORY, 'postgresql.conf'), `\n# Isolated Phase 2 sandbox only\nlisten_addresses = '127.0.0.1'\nport = ${PORT}\ncluster_name = '${identity.clusterName}'\nphase2.sandbox_nonce = '${identity.nonce}'\npassword_encryption = 'scram-sha-256'\nlog_statement = 'none'\nlog_min_error_statement = 'panic'\nlog_parameter_max_length = 0\nlog_parameter_max_length_on_error = 0\n`);
  runBinary('pg_ctl.exe', ['start','-D',DIRECTORY,'-l',path.join(DIRECTORY,'server.log'),'-w','-t','30']);
  identity.pid = Number(fs.readFileSync(path.join(DIRECTORY,'postmaster.pid'),'utf8').split(/\r?\n/)[0]);
  fs.writeFileSync(IDENTITY, JSON.stringify(identity,null,2), { mode: 0o600 });
  verifyOperatingSystem(identity);
  const { Client } = require('pg'); const admin = new Client(pgConfig(secret, 'postgres', true));
  try {
    await admin.connect(); await attest(admin, 'postgres', ADMIN);
    // Generated hex only; never command-line arguments, tool output or server statement logs.
    await admin.query(`CREATE ROLE ${ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${secret.testPassword}'`);
    // Read-only server attestation by the test role needs only this monitoring setting.
    await admin.query(`GRANT pg_read_all_settings TO ${ROLE}`);
  } finally { await admin.end(); }
  await createDatabase(secret, DATABASE_PREFIX);
  console.log('PASS: dedicated PostgreSQL 17 cluster provisioned; loopback listener, process, data directory, cluster identifier and nonce verified. Credentials protected with Windows DPAPI.');
}
async function newDatabase() {
  const secret = readSecrets();
  const revision = Number(secret.database.match(/_r(\d+)$/)?.[1] ?? 1) + 1;
  await createDatabase(secret, `${DATABASE_PREFIX}_r${revision}`);
}
async function prepareRecoveredSandbox() {
  verifyOperatingSystem();
  const secret = readSecrets();
  if (secret.bootstrapOnly !== true || secret.recoveryState !== 'RECOVERED_BOOTSTRAP_ONLY') throw new IsolationError('Recovered bootstrap-only sandbox state is required');
  if (!/^[a-f0-9]{64}$/.test(secret.testPassword ?? '')) throw new IsolationError('Protected test credential is missing or malformed');
  const { Client } = require('pg');
  const admin = new Client(pgConfig(secret, 'postgres', true));
  try {
    await admin.connect(); await attest(admin, 'postgres', ADMIN);
    const { rows } = await admin.query('SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$1) AS role_exists, EXISTS(SELECT 1 FROM pg_database WHERE datname=$2) AS database_exists', [ROLE, DATABASE_PREFIX]);
    if (rows[0].role_exists || rows[0].database_exists) throw new IsolationError('Unexpected pre-existing test role or database; refusing to overwrite');
    await admin.query(`CREATE ROLE ${ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${secret.testPassword}'`);
    await admin.query(`GRANT pg_read_all_settings TO ${ROLE}`);
    console.log('PASS: authenticated bootstrap attestation; dedicated non-superuser test role created in the verified sandbox.');
  } finally { await admin.end(); }
  await createDatabase(secret, DATABASE_PREFIX);
  secret.bootstrapOnly = false; secret.recoveryState = 'TEST_DATABASE_PREPARED'; writeSecrets(secret);
  console.log('PASS: dedicated test database created; protected credentials retained.');
}
function testEnvironment() {
  const secret = readSecrets(); const identity = readIdentity();
  if (secret.bootstrapOnly) throw new Error('Test role/database provisioning is still pending explicit approval');
  return { PHASE2_TEST_DATABASE_URL: `postgresql://${ROLE}:${secret.testPassword}@127.0.0.1:${PORT}/${secret.database}`, PHASE2_TEST_NONCE: identity.nonce };
}
module.exports = { ROOT, DIRECTORY, PORT, ROLE, IsolationError, cleanEnvironment, readIdentity, verifyOperatingSystem, serverAttestationComparison, assertServerAttestation, attest, provision, prepareRecoveredSandbox, newDatabase, testEnvironment, writeSecrets, readSecrets };
