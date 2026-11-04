// Creates its OWN temporary loopback-only PostgreSQL cluster. Never reads .env.
const fs = require('fs'),
  path = require('path'),
  { randomBytes } = require('crypto');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const bin =
  process.env.ONBOARDING_PG_BIN || 'C:/Program Files/PostgreSQL/17/bin';
const exe = (name) =>
  path.join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
if (!fs.existsSync(exe('initdb')))
  throw Error('Set ONBOARDING_PG_BIN to a local PostgreSQL bin directory');
const nonce = randomBytes(8).toString('hex'),
  database = `onboarding_test_${nonce}`;
const dir = path.resolve(root, '../.tmp', `onboarding-pg-${nonce}`),
  data = path.join(dir, 'data');
fs.mkdirSync(dir, { recursive: false });
const port = 55447;
function run(command, args, options = {}) {
  const r = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    stdio: 'ignore',
    timeout: 90000,
    ...options,
  });
  if (r.status !== 0)
    throw Error(
      `Local onboarding test command failed: ${path.basename(command)}`,
    );
}
let started = false;
try {
  run(exe('initdb'), [
    '-D',
    data,
    '--no-locale',
    '--encoding=UTF8',
    '--auth=trust',
    '--username=postgres',
  ]);
  run(exe('pg_ctl'), [
    '-D',
    data,
    '-l',
    path.join(dir, 'postgres.log'),
    '-o',
    `-h 127.0.0.1 -p ${port} -c max_connections=20`,
    '-w',
    'start',
  ]);
  started = true;
  run(exe('createdb'), [
    '-h',
    '127.0.0.1',
    '-p',
    String(port),
    '-U',
    'postgres',
    database,
  ]);
  const env = {
    ...process.env,
    ONBOARDING_ISOLATED_NONCE: nonce,
    ONBOARDING_TEST_DATABASE_URL: `postgres://postgres@127.0.0.1:${port}/${database}`,
  };
  const r = spawnSync(
    process.execPath,
    [
      '--experimental-vm-modules',
      'node_modules/jest/bin/jest.js',
      '--runInBand',
      '--runTestsByPath',
      'src/modules/parent-admission/welcome.integration.spec.ts',
    ],
    { cwd: root, env, windowsHide: true, stdio: 'inherit' },
  );
  process.exitCode = r.status ?? 1;
} finally {
  if (started) run(exe('pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop']);
  console.log(
    'Isolated onboarding PostgreSQL cluster stopped. No shared database was used.',
  );
}
