// Explicitly authorized credential-only recovery. No migrations, fixture schema,
// test execution, application startup, role creation or database creation.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const sandbox = require('./parent-registration-sandbox.cjs');
const BIN = 'C:\\Program Files\\PostgreSQL\\17\\bin';
const ADMIN = 'etlaasot_sandbox_admin';
const identityFile = path.join(sandbox.DIRECTORY, 'phase2-identity.json');
const credentialFile = path.join(sandbox.DIRECTORY, 'phase2-credentials.dpapi');
const hbaFile = path.join(sandbox.DIRECTORY, 'pg_hba.conf');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const normalize = value => path.resolve(value).replace(/\\/g, '/').toLowerCase();
const PS = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
function powershell(script) {
  const result = spawnSync(PS, ['-NoProfile','-NonInteractive','-Command', "$ErrorActionPreference='Stop'; "+script], { encoding:'utf8', windowsHide:true, env:sandbox.cleanEnvironment(), timeout:20000 });
  if (result.status !== 0) throw new sandbox.IsolationError('Recovery OS inspection failed');
  return result.stdout.trim();
}
function verifyStopped(identity) {
  if (normalize(fs.realpathSync(sandbox.DIRECTORY)) !== normalize(identity.directory)) throw new sandbox.IsolationError('Recovery data directory identity changed');
  const state = JSON.parse(powershell(`@{listeners=@(Get-NetTCPConnection -State Listen -LocalPort 55439 -ErrorAction SilentlyContinue); oldProcessPresent=[bool](Get-Process -Id ${Number(identity.pid)} -ErrorAction SilentlyContinue)} | ConvertTo-Json -Compress`));
  if (state.listeners.length || state.oldProcessPresent || fs.existsSync(path.join(sandbox.DIRECTORY,'postmaster.pid'))) throw new sandbox.IsolationError('Sandbox did not stop exclusively and cleanly');
  const result=spawnSync(path.join(BIN,'pg_controldata.exe'),['-D',sandbox.DIRECTORY],{encoding:'utf8',windowsHide:true,env:sandbox.cleanEnvironment(),timeout:10000});
  if (result.status!==0 || result.stdout.match(/Database system identifier:\s*(\d+)/)?.[1]!==identity.systemIdentifier) throw new sandbox.IsolationError('Stopped sandbox cluster identifier mismatch');
  const manifest = sandbox.readIdentity();
  if (JSON.stringify(manifest)!==JSON.stringify(identity)) throw new sandbox.IsolationError('Recovery manifest changed unexpectedly');
}
function runControl(args) {
  // Use file handles instead of pipes for pg_ctl start: the background postmaster
  // must not retain a pipe that keeps the foreground recovery process waiting.
  const log=fs.openSync(path.join(sandbox.DIRECTORY,'credential-recovery-control.log'),'a');
  try {
    const result=spawnSync(path.join(BIN,'pg_ctl.exe'),args,{stdio:['ignore',log,log],windowsHide:true,env:sandbox.cleanEnvironment(),timeout:60000});
    if (result.status!==0) throw new Error('Dedicated sandbox control operation failed');
  } finally { fs.closeSync(log); }
}
async function main() {
  if (process.argv.length!==3 || process.argv[2]!=='--recover-credentials-only') throw new Error('Explicit recovery mode is required');
  const identity = sandbox.verifyOperatingSystem();
  if (fs.existsSync(credentialFile)) throw new sandbox.IsolationError('Credential file already exists; refusing unreviewed overwrite');
  const hbaHash = hash(hbaFile);
  const rules=fs.readFileSync(hbaFile,'utf8').split(/\r?\n/).map(x=>x.split('#')[0].trim()).filter(Boolean);
  if (!rules.length || rules.some(x=>!/^\s*(local|host)\s/.test(x) || !/\bscram-sha-256\s*$/.test(x))) throw new sandbox.IsolationError('Sandbox authentication rules are not exclusively SCRAM');
  const secret={adminPassword:randomBytes(32).toString('hex'),testPassword:randomBytes(32).toString('hex'),database:'etlaasot_parent_registration_test_20261020_a',bootstrapOnly:true,recoveryState:'PREPARED'};
  // Persist first, before changing the password. Only CurrentUser DPAPI ciphertext
  // is written; directory ACL already restricts access to the owner and SYSTEM.
  sandbox.writeSecrets(secret);
  if (sandbox.readSecrets().adminPassword!==secret.adminPassword) throw new sandbox.IsolationError('Secure credential persistence verification failed');
  sandbox.verifyOperatingSystem();
  console.log('PASS: pre-change OS identity, cluster manifest, protected credential persistence and SCRAM-only authentication verified.');
  runControl(['stop','-D',sandbox.DIRECTORY,'-m','fast','-w','-t','30']);
  verifyStopped(identity);
  if(hash(hbaFile)!==hbaHash) throw new sandbox.IsolationError('Authentication configuration changed unexpectedly');
  // Offline administrator maintenance; TCP is stopped and pg_hba.conf is unchanged.
  // Password appears only on stdin, never in arguments, files, logs or reports.
  const recovery=spawnSync(path.join(BIN,'postgres.exe'),['--single','-D',sandbox.DIRECTORY,'-c','password_encryption=scram-sha-256','-c','log_statement=none','-c','log_min_error_statement=panic','-c','log_error_verbosity=terse','postgres'],{input:`ALTER ROLE ${ADMIN} PASSWORD '${secret.adminPassword}';\n`,encoding:'utf8',windowsHide:true,env:sandbox.cleanEnvironment(),timeout:60000,maxBuffer:1024*1024});
  if(recovery.status!==0 || /\b(?:ERROR|FATAL|PANIC):/i.test(recovery.stderr+'\n'+recovery.stdout)) throw new Error('Sandbox credential-only offline maintenance failed; values suppressed');
  verifyStopped(identity);
  if(hash(hbaFile)!==hbaHash) throw new sandbox.IsolationError('Authentication configuration changed during credential recovery');
  runControl(['start','-D',sandbox.DIRECTORY,'-l',path.join(sandbox.DIRECTORY,'server.log'),'-w','-t','30']);
  const newPid=Number(fs.readFileSync(path.join(sandbox.DIRECTORY,'postmaster.pid'),'utf8').split(/\r?\n/)[0]);
  const nextIdentity={...identity,pid:newPid};
  // Validate the new PID against the unchanged directory/executable/cluster before
  // recording the expected PID change caused by this authorized sandbox restart.
  sandbox.verifyOperatingSystem(nextIdentity);
  fs.writeFileSync(identityFile,JSON.stringify(nextIdentity,null,2),{mode:0o600});
  sandbox.verifyOperatingSystem();
  const {Client}=require('pg');
  const client=new Client({host:'127.0.0.1',port:55439,user:ADMIN,password:secret.adminPassword,database:'postgres',ssl:false,connectionTimeoutMillis:5000,application_name:'phase2-credential-recovery-read-only',options:'-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=3000'});
  try {
    await client.connect();
    await sandbox.attest(client,'postgres',ADMIN);
    const {rows}=await client.query("SELECT current_database() AS database, current_user AS role, host(inet_server_addr()) AS host, inet_server_addr()::text AS original_address_format, inet_server_port() AS port, current_setting('data_directory') AS directory, current_setting('default_transaction_read_only') AS read_only, (SELECT rolpassword LIKE 'SCRAM-SHA-256$%' FROM pg_authid WHERE rolname = current_user) AS password_is_scram, EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'etlaasot_test_runner') AS test_role_exists, EXISTS(SELECT 1 FROM pg_database WHERE datname = 'etlaasot_parent_registration_test_20261020_a') AS test_database_exists");
    const observed=rows[0];
    if(observed.read_only!=='on' || observed.password_is_scram!==true || hash(hbaFile)!==hbaHash) throw new sandbox.IsolationError('Post-recovery SCRAM/read-only authentication verification failed');
    secret.recoveryState='RECOVERED_BOOTSTRAP_ONLY';sandbox.writeSecrets(secret);
    console.log(JSON.stringify({status:'PASS',credentialRecovery:'administrator password reset; DPAPI persistence verified',attestation:'all fields passed',database:observed.database,role:observed.role,host:observed.host,port:observed.port,directory:observed.directory,oldPid:identity.pid,pid:newPid,clusterIdentifierUnchanged:true,nonceVerified:true,nonceValue:'[redacted]',authentication:'SCRAM-SHA-256',hbaUnchanged:true,authenticatedReadOnly:true,originalAddressFormat:observed.original_address_format,testRoleExists:observed.test_role_exists,testDatabaseExists:observed.test_database_exists,migrationsRun:false,integrationTestsRun:false}));
  } finally {await client.end();}
}
main().catch(error=>{console.error(error.code==='PHASE2_ISOLATION_FAILURE'?`STOP: ${error.message}`:'STOP: credential recovery failed; credential and SQL values suppressed');process.exitCode=error.code==='PHASE2_ISOLATION_FAILURE'?86:1;});
