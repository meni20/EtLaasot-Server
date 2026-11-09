// Fresh loopback-only PostgreSQL cluster, synthetic data, no application .env.
const fs = require('fs'),
  path = require('path'),
  net = require('net');
const { spawnSync } = require('child_process');
const { randomBytes } = require('crypto');
async function main() {
  if (process.argv[2] !== '--execute') {
    console.log('PLAN ONLY: fresh isolated PostgreSQL approval verification');
    return;
  }
  const root = path.resolve(__dirname, '..'),
    nonce = randomBytes(8).toString('hex');
  const dir = path.join(root, '.tmp', `approval-pg-${nonce}`),
    bin = 'C:/Program Files/PostgreSQL/17/bin';
  fs.mkdirSync(dir, { recursive: true });
  const env = {};
  for (const key of [
    'PATH',
    'Path',
    'SystemRoot',
    'WINDIR',
    'COMSPEC',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
  ])
    if (process.env[key]) env[key] = process.env[key];
  const port = await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  const run = (name, args) => {
    const r = spawnSync(path.join(bin, name + '.exe'), args, {
      env,
      encoding: 'utf8',
      windowsHide: true,
      stdio: 'ignore',
      timeout: 45000,
    });
    if (r.status !== 0) throw Error('LOCAL_' + name + '_FAILED');
  };
  let started = false;
  try {
    run('initdb', [
      '-D',
      dir,
      '-U',
      'postgres',
      '--auth=trust',
      '--encoding=UTF8',
      '--no-locale',
    ]);
    run('pg_ctl', [
      '-D',
      dir,
      '-l',
      path.join(dir, 'server.log'),
      '-o',
      `-h 127.0.0.1 -p ${port}`,
      '-w',
      'start',
    ]);
    started = true;
    const r = spawnSync(
      process.execPath,
      [
        '--experimental-vm-modules',
        'node_modules/jest/bin/jest.js',
        '--runInBand',
        '--runTestsByPath',
        'src/modules/parent-admission/approval-password.integration.spec.ts',
      ],
      {
        cwd: root,
        env: {
          ...env,
          APPROVAL_PG_NONCE: nonce,
          APPROVAL_PG_PORT: String(port),
          APPROVAL_PG_DIRECTORY: dir,
        },
        windowsHide: true,
        stdio: 'inherit',
      },
    );
    process.exitCode = r.status ?? 1;
  } finally {
    if (started) run('pg_ctl', ['-D', dir, '-m', 'fast', '-w', 'stop']);
    console.log(
      'Fresh isolated PostgreSQL stopped; shared databases untouched.',
    );
  }
}
main().catch(() => {
  console.error('LOCAL_APPROVAL_VERIFICATION_FAILED');
  process.exitCode = 1;
});
