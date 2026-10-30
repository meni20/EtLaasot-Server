// Local orchestration only. Never modifies Railway variables, runs migrations,
// creates databases/buckets, or loads the mixed root .env file.
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { Client } = require('pg');
const {
  StartupError,
  step,
  describe,
  readConfig,
  validateKey,
  windowsUserSid,
  checkPort,
  checkDocuments,
} = require('./phase5-startup.cjs');
const root = path.resolve(__dirname, '..'),
  workspace = path.dirname(root),
  dir = path.join(root, '.tmp', 'phase5-local'),
  file = path.join(dir, 'config.json');
async function attest(env) {
  assert.equal(env.DB_USER, 'etlaasot_app.vlysppqfozfiwcmsyban');
  assert.equal(env.SUPABASE_URL, 'https://vlysppqfozfiwcmsyban.supabase.co');
  assert.equal(env.DB_HOST, 'aws-0-eu-central-1.pooler.supabase.com');
  assert.equal(env.DB_PORT, '5432');
  assert.equal(env.DB_NAME, 'postgres');
  assert.equal(env.DB_SSL_REJECT_UNAUTHORIZED, 'true');
  const c = new Client({
    host: env.DB_HOST,
    port: 5432,
    database: 'postgres',
    user: env.DB_USER,
    password: env.DB_PASS,
    ssl: {
      rejectUnauthorized: true,
      ca: fs.readFileSync(path.resolve(root, env.DB_SSL_CA_PATH), 'utf8'),
    },
    connectionTimeoutMillis: 15000,
  });
  try {
    await c.connect();
    await c.query('BEGIN READ ONLY');
    const r = (
      await c.query(
        "SELECT current_database()='postgres' AND current_user='etlaasot_app' AND inet_server_addr()='2a05:d014:8ef:5902:b67d:7199:8fac:e6d0'::inet AND inet_server_port()=5432 AS ok",
      )
    ).rows[0];
    assert.equal(r.ok, true);
    assert.equal(c.connection.stream.authorized, true);
    const migrations = (
      await c.query(
        "SELECT count(*)::int AS n FROM public.schema_migrations WHERE filename IN ('030_parent_registration.sql','031_parent_applications.sql','032_registration_medical_image_mime.sql')",
      )
    ).rows[0];
    assert.equal(migrations.n, 3);
    await c.query('COMMIT');
  } finally {
    await c.end();
  }
}
function save(config) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
  if (process.platform === 'win32') {
    const user = windowsUserSid();
    execFileSync(
      'icacls',
      [dir, '/inheritance:r', '/grant:r', `${user}:(OI)(CI)F`],
      { stdio: 'ignore' },
    );
    execFileSync('icacls', [file, '/inheritance:r', '/grant:r', `${user}:F`], {
      stdio: 'ignore',
    });
  }
}
async function run() {
  const action = process.argv[2];
  if (action === 'prepare' || action === 'prepare-local') {
    let input = '';
    if (action === 'prepare') for await (const b of process.stdin) input += b;
    const vars = await step('LOCAL_ENV_READ', () =>
      action === 'prepare-local'
        ? require('node:util').parseEnv(
            fs.readFileSync(path.join(root, '.env.development.local'), 'utf8'),
          )
        : JSON.parse(input),
    );
    await step('DEV_ATTESTATION_FAILED', () => attest(vars));
    const previous = fs.existsSync(file) ? readConfig(file) : null;
    const suffix = previous?.suffix ?? crypto.randomBytes(4).toString('hex');
    const config = {
      suffix,
      // Fixture metadata only; these names never restrict the running app.
      branches: [`phase5-${suffix}-a`, `phase5-${suffix}-b`],
      env: {},
    };
    for (const [k, v] of Object.entries(vars))
      if (
        !k.startsWith('RAILWAY_') &&
        ![
          'NODE_ENV',
          'PORT',
          'PARENT_REGISTRATION_LOCAL_TEST_BRANCHES',
        ].includes(k)
      )
        config.env[k] = String(v);
    Object.assign(config.env, {
      NODE_ENV: 'development',
      BRANCH_NAME: 'feature/parent-registration-phase5',
      PORT: '3185',
      HOST: '127.0.0.1',
      COOKIE_CROSS_SITE: 'false',
      DB_SYNC: 'false',
      DB_LOGGING: 'false',
      CORS_ORIGINS: 'http://127.0.0.1:5185',
      PARENT_REGISTRATION_ENABLED: 'true',
      PARENT_REGISTRATION_BLOCKING_ENABLED: 'true',
      PARENT_ADMISSION_SCHEMA_READY: 'true',
      ID_FIRST_LOGIN_ENABLED: 'true',
      APPLICANT_REGISTRATION_ENABLED: 'true',
      PARENT_REGISTRATION_INTEGRATION_ENABLED: 'true',
      REGISTRATION_DOCUMENTS_URL: 'http://127.0.0.1:3285/',
      REGISTRATION_DOCUMENTS_API_KEY:
        previous?.env.REGISTRATION_DOCUMENTS_API_KEY ??
        crypto.randomBytes(32).toString('hex'),
      PARENT_REGISTRATION_TOKEN_PEPPER:
        previous?.env.PARENT_REGISTRATION_TOKEN_PEPPER ??
        crypto.randomBytes(32).toString('hex'),
      JWT_SECRET:
        previous?.env.JWT_SECRET ?? crypto.randomBytes(48).toString('hex'),
    });
    const { loadRuntimeEnvironment } = require('./runtime-environment.cjs');
    const checked = { ...config.env };
    await step('ENCRYPTION_CONFIG_MISMATCH', () =>
      loadRuntimeEnvironment({
        rootDir: root,
        env: checked,
        branch: 'feature/parent-registration-phase5',
      }),
    );
    await step('ENCRYPTION_CONFIG_MISMATCH', () =>
      assert.equal(
        checked.NATIONAL_ID_ENCRYPTION_KEY,
        config.env.NATIONAL_ID_ENCRYPTION_KEY,
        'Existing DEV encryption key differs; stop without rotating it',
      ),
    );
    validateKey(config.env.REGISTRATION_DOCUMENTS_API_KEY);
    await step('LOCAL_CONFIG_SAVE', () => save(config));
    console.log(
      JSON.stringify({
        prepared: true,
        project: 'EtLaasot-dev',
        ports: { client: 5185, server: 3185, documents: 3285 },
        branchScope: 'all DEV branches, subject to standard permissions',
        recaptchaConfigured: !!config.env.RECAPTCHA_SECRET_KEY,
        secretsPrinted: false,
      }),
    );
    return;
  }
  if (!['server', 'client', 'documents', 'verify'].includes(action)) {
    console.log(
      'Commands: prepare-local (existing verified local DEV configuration), prepare (verified DEV variables on stdin), verify, server, client, documents. No migrations or cloud configuration changes.',
    );
    return;
  }
  const config = readConfig(file);
  await step('DEV_ATTESTATION_FAILED', () => attest(config.env));
  if (action === 'verify') {
    console.log(
      'PASS: Supabase DEV identity, TLS and migrations 030/031/032 verified; no writes.',
    );
    return;
  }
  let cwd = root,
    args,
    env = { ...process.env, ...config.env };
  for (const key of Object.keys(env))
    if (
      key.startsWith('RAILWAY_') ||
      key === 'PARENT_REGISTRATION_LOCAL_TEST_BRANCHES'
    )
      delete env[key];
  if (action === 'server') args = ['dist/main.js'];
  if (action === 'documents') {
    cwd = path.join(workspace, 'EtLaasot-Documents');
    env = {
      ...process.env,
      NODE_ENV: 'development',
      PORT: '3285',
      HOST: '127.0.0.1',
      PDF_BROWSER_CHANNEL: 'chrome',
      INTERNAL_API_KEY: config.env.REGISTRATION_DOCUMENTS_API_KEY,
    };
    args = ['dist/main.js'];
  }
  if (action === 'client') {
    cwd = path.join(workspace, 'EtLaasot-Client');
    env = {
      ...process.env,
      VITE_SERVER_URL: 'http://127.0.0.1:3185',
      VITE_PARENT_REGISTRATION_API_URL: 'http://127.0.0.1:3185',
      VITE_PARENT_REGISTRATION_ENVIRONMENT: 'dev',
      VITE_ID_FIRST_LOGIN_ENABLED: 'true',
      VITE_APPLICANT_REGISTRATION_ENABLED: 'true',
      VITE_PARENT_REGISTRATION_ENABLED: 'true',
      VITE_PARENT_REGISTRATION_BLOCKING_ENABLED: 'true',
    };
    args = [
      'node_modules/vite/bin/vite.js',
      '--config',
      'vite.phase5.config.ts',
    ];
  }
  const port = { documents: 3285, server: 3185, client: 5185 }[action];
  validateKey(config.env.REGISTRATION_DOCUMENTS_API_KEY);
  if (!fs.existsSync(path.join(cwd, args[0]))) {
    throw new StartupError(
      action === 'client' ? 'RUNTIME_DEPENDENCY_MISSING' : 'BUILD_MISSING',
    );
  }
  await checkPort(port);
  if (action === 'documents') {
    await checkDocuments(cwd);
    console.log(
      'PASS: Documents key format, compiled templates/fonts, Playwright and installed Chrome PDF runtime; secrets redacted.',
    );
  }
  console.log(`Starting Phase 5 ${action} on 127.0.0.1:${port}`);
  const child = spawn(process.execPath, args, {
    cwd,
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  child.on('error', () => {
    console.error(describe(new StartupError('CHILD_SPAWN_FAILED')));
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    if (code !== 0)
      console.error(describe(new StartupError('CHILD_EXIT_FAILED')));
    process.exitCode = code ?? 1;
  });
}
module.exports = { attest, file, dir, root, save };
if (require.main === module)
  run().catch((error) => {
    console.error(
      `Local Phase 5 ${process.argv[2] || 'operation'} failed ${describe(error)}`,
    );
    process.exitCode = 1;
  });
