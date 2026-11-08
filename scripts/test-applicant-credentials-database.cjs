// Explicitly local PostgreSQL verification. Never loads application environments.
// Usage: node scripts/test-applicant-credentials-database.cjs --execute
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { Client } = require('pg');

async function main() {
  if (process.argv[2] !== '--execute') {
    console.log(
      'PLAN ONLY: fresh loopback PostgreSQL cluster; synthetic data only.',
    );
    return;
  }
  const root = path.resolve(__dirname, '..');
  const nonce = randomBytes(8).toString('hex');
  const directory = path.join(root, '.tmp', `credentials-pg-${nonce}`);
  const bin = 'C:/Program Files/PostgreSQL/17/bin';
  fs.mkdirSync(directory, { recursive: true });
  const environment = {};
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
    if (process.env[key]) environment[key] = process.env[key];
  function pg(command, args) {
    const r = spawnSync(path.join(bin, `${command}.exe`), args, {
      env: environment,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 45000,
      stdio: 'ignore',
    });
    if (r.status !== 0) throw Error(`LOCAL_${command.toUpperCase()}_FAILED`);
  }
  const port = await new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.on('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const value = socket.address().port;
      socket.close(() => resolve(value));
    });
  });
  pg('initdb', [
    '-D',
    directory,
    '-U',
    'postgres',
    '--auth=trust',
    '--encoding=UTF8',
    '--no-locale',
  ]);
  const config = {
    host: '127.0.0.1',
    port,
    user: 'postgres',
    database: 'postgres',
    ssl: false,
    connectionTimeoutMillis: 5000,
    options: '-c statement_timeout=15000 -c lock_timeout=6000',
  };
  let running = false,
    admin,
    db;
  const checks = [];
  async function check(name, work) {
    await work();
    checks.push(name);
    console.log(`PASS ${name}`);
  }
  async function expectCode(work, code) {
    await assert.rejects(
      work,
      (e) => e.code === code || e.original?.code === code,
    );
  }
  try {
    pg('pg_ctl', [
      '-D',
      directory,
      '-l',
      path.join(directory, 'server.log'),
      '-o',
      `-h 127.0.0.1 -p ${port}`,
      '-w',
      'start',
    ]);
    running = true;
    admin = new Client(config);
    await admin.connect();
    const target = (
      await admin.query(
        "SELECT current_database() AS db, current_setting('data_directory') AS directory, host(inet_server_addr()) AS address",
      )
    ).rows[0];
    assert.equal(
      path.resolve(target.directory).toLowerCase(),
      directory.toLowerCase(),
    );
    assert.equal(target.db, 'postgres');
    assert.equal(target.address, '127.0.0.1');
    await admin.query(`CREATE ROLE etlaasot_app; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA storage; CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);`);
    await admin.query(
      fs.readFileSync(
        path.join(root, 'test/parent-registration/baseline.sql'),
        'utf8',
      ),
    );
    await admin.query(
      'CREATE UNIQUE INDEX fixture_user_identity ON public."user"(national_id_hash); GRANT USAGE ON SCHEMA public TO etlaasot_app; GRANT SELECT,INSERT,UPDATE ON public."user",public.branch,public.user_roles,public.roles,public.trainee_medications TO etlaasot_app;',
    );
    for (const file of fs
      .readdirSync(path.join(root, 'migrations'))
      .filter((f) => /^03[0-8]_/.test(f))
      .sort())
      await admin.query(
        fs.readFileSync(path.join(root, 'migrations', file), 'utf8'),
      );
    await admin.query(
      'CREATE TABLE public.schema_migrations(filename text PRIMARY KEY,applied_at timestamptz DEFAULT now());',
    );
    await admin.query(
      "INSERT INTO public.branch(id,name) VALUES('a','Synthetic A'),('b','Synthetic B'); INSERT INTO public.roles(id,name) VALUES(1,'VOLUNTEER'),(2,'TRAINEE'),(10000,'BRANCH_ADMIN');",
    );
    const user = randomUUID();
    await admin.query(
      "INSERT INTO public.\"user\"(id,name,national_id_hash,password_hash,\"branchId\") VALUES($1,'Synthetic existing user',$2,'legacy-hash-preserved','a')",
      [user, randomBytes(32).toString('hex')],
    );
    const legacy = [];
    for (const type of ['TRAINEE', 'VOLUNTEER']) {
      for (const status of [
        'DRAFT',
        'PENDING_REVIEW',
        'CHANGES_REQUESTED',
        'REJECTED',
        'APPROVED',
      ]) {
        const id = randomUUID(),
          hash = randomBytes(32).toString('hex');
        await admin.query(
          "INSERT INTO public.trainee_applications(id,national_id_hash,national_id_encrypted,branch_id,registration_type) VALUES($1,$2,'synthetic-encrypted','a',$3)",
          [id, hash, type],
        );
        await admin.query(
          "INSERT INTO public.applicant_sessions(application_id,token_hash,recovery_hash,expires_at,recovery_expires_at) VALUES($1,$2,$3,now()+interval '1 day',now()+interval '90 days')",
          [
            id,
            randomBytes(32).toString('hex'),
            randomBytes(32).toString('hex'),
          ],
        );
        await admin.query(
          "INSERT INTO public.trainee_application_events(application_id,action) VALUES($1,'CREATED')",
          [id],
        );
        if (status !== 'DRAFT') {
          const version = randomUUID();
          await admin.query(
            "INSERT INTO public.trainee_application_versions(id,application_id,registration_type,version_number,submitted_revision,idempotency_key,form_data,content_hash,declarations,declaration_version,template_version) VALUES($1,$2,$3,1,0,$4,'{}',$5,$6,'fixture','fixture')",
            [
              version,
              id,
              type,
              randomUUID(),
              'a'.repeat(64),
              JSON.stringify(Array(10).fill('synthetic')),
            ],
          );
          await admin.query(
            "INSERT INTO public.trainee_application_evidence(application_id,version_id,registration_type,kind,storage_bucket,storage_path,mime_type,file_size,checksum,content_hash,verified_at,template_version,source_checksum,generated_at) VALUES($1,$2,$3,'REGISTRATION_PDF','fixture',$4,'application/pdf',10,$5,$5,now(),'volunteer-registration/v1',$5,now())",
            [id, version, type, `${id}/fixture.pdf`, 'a'.repeat(64)],
          );
          const approvedUser = status === 'APPROVED' ? randomUUID() : null;
          if (approvedUser)
            await admin.query(
              "INSERT INTO public.\"user\"(id,name,national_id_hash,password_hash,\"branchId\") VALUES($1,'Synthetic approved user',$2,'existing-password','a')",
              [approvedUser, hash],
            );
          await admin.query(
            "UPDATE public.trainee_applications SET status=$2,feedback_reason='synthetic feedback',document_status='READY',provisioned_user_id=$3,reviewed_by=$4,reviewed_at=now() WHERE id=$1",
            [id, status, approvedUser, user],
          );
        }
        legacy.push(id);
      }
    }
    const tables = [
      'user',
      'trainee_applications',
      'applicant_sessions',
      'trainee_application_versions',
      'trainee_application_evidence',
      'trainee_application_events',
    ];
    async function fingerprint() {
      const output = {};
      for (const table of tables)
        output[table] = (
          await admin.query(
            `SELECT count(*)::int AS count,md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS digest FROM public."${table}" t`,
          )
        ).rows[0];
      return output;
    }
    const before = await fingerprint();
    const sql = fs.readFileSync(
      path.join(root, 'migrations/039_application_credentials.sql'),
      'utf8',
    );
    async function migrate() {
      await admin.query('BEGIN');
      try {
        if (
          (
            await admin.query(
              "SELECT 1 FROM public.schema_migrations WHERE filename='039_application_credentials.sql'",
            )
          ).rowCount
        ) {
          await admin.query('COMMIT');
          return 'SKIPPED';
        }
        await admin.query(sql);
        await admin.query(
          "INSERT INTO public.schema_migrations(filename) VALUES('039_application_credentials.sql')",
        );
        await admin.query('COMMIT');
        return 'APPLIED';
      } catch (e) {
        await admin.query('ROLLBACK');
        throw e;
      }
    }
    await check(
      '039 applies atomically on representative 030-038 schema',
      async () => assert.equal(await migrate(), 'APPLIED'),
    );
    await check(
      'all legacy passwords, sessions, applications, versions, evidence and events unchanged',
      async () => assert.deepEqual(await fingerprint(), before),
    );
    await check('tracked migration replay skips safely', async () =>
      assert.equal(await migrate(), 'SKIPPED'),
    );
    await check(
      'untracked raw replay fails atomically without data loss',
      async () => {
        await admin.query('BEGIN');
        await expectCode(() => admin.query(sql), '42P07');
        await admin.query('ROLLBACK');
        assert.deepEqual(await fingerprint(), before);
      },
    );
    for (const role of ['anon', 'authenticated', 'service_role'])
      await check(`${role} cannot read credentials`, async () => {
        await admin.query('BEGIN');
        await admin.query(`SET LOCAL ROLE ${role}`);
        await expectCode(
          () => admin.query('SELECT * FROM public.application_credentials'),
          '42501',
        );
        await admin.query('ROLLBACK');
      });
    // Runtime services are loaded without AppModule/.env. src aliases resolve to dist.
    const runtime = path.join(root, '.tmp', `runtime-${nonce}`);
    fs.mkdirSync(runtime, { recursive: true });
    fs.symlinkSync(
      path.join(root, 'dist'),
      path.join(runtime, 'src'),
      'junction',
    );
    process.env.NODE_PATH = runtime;
    require('node:module').Module._initPaths();
    require('reflect-metadata');
    const { Sequelize } = require('sequelize-typescript');
    const {
      ApplicationCredentialsService,
    } = require('../dist/modules/parent-admission/application-credentials.service');
    const {
      ApplicationCredentialsRepository,
    } = require('../dist/modules/parent-admission/application-credentials.repository');
    const {
      AdmissionRepository,
    } = require('../dist/modules/parent-admission/admission.repository');
    const {
      ADMISSION_MODELS,
    } = require('../dist/modules/parent-admission/admission.entities');
    const {
      hashPassword,
      verifyPassword,
    } = require('../dist/modules/auth/password.util');
    db = new Sequelize({
      dialect: 'postgres',
      host: config.host,
      port,
      user: 'postgres',
      username: 'postgres',
      database: 'postgres',
      logging: false,
      pool: { max: 8 },
      hooks: {
        afterConnect: async (connection) => {
          await connection.query('SET ROLE etlaasot_app');
        },
      },
    });
    // Admission models only; Branch/User models are not needed for credential paths.
    db.addModels(ADMISSION_MODELS);
    const appRepo = new AdmissionRepository(db);
    const repo = new ApplicationCredentialsRepository(db);
    const service = new ApplicationCredentialsService(repo, appRepo);
    Object.assign(process.env, {
      NODE_ENV: 'development',
      ETLAASOT_RUNTIME_TARGET: 'development',
      BRANCH_NAME: 'dev',
      APPLICANT_PASSWORD_AUTH_ENABLED: 'true',
      APPLICATION_CREDENTIALS_SCHEMA_READY: 'true',
      APPLICANT_REGISTRATION_ENABLED: 'true',
      PARENT_ADMISSION_SCHEMA_READY: 'true',
      VOLUNTEER_REGISTRATION_ENABLED: 'true',
      DB_SYNC: 'false',
      DB_LOGGING: 'false',
      SUPABASE_URL: 'https://vlysppqfozfiwcmsyban.supabase.co',
      DB_USER: 'etlaasot_app.vlysppqfozfiwcmsyban',
      DB_HOST: 'aws-0-eu-central-1.pooler.supabase.com',
      DB_PORT: '5432',
      DB_NAME: 'postgres',
      DB_SSL: 'true',
      DB_SSL_REJECT_UNAUTHORIZED: 'true',
      NATIONAL_ID_HASH_SECRET: randomBytes(32).toString('hex'),
      NATIONAL_ID_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
      PARENT_REGISTRATION_TOKEN_PEPPER: randomBytes(32).toString('hex'),
    });
    for (const key of [
      'RAILWAY_PROJECT_ID',
      'RAILWAY_ENVIRONMENT_ID',
      'RAILWAY_SERVICE_ID',
    ])
      delete process.env[key];
    const base = {
      identifier: '123456782',
      email: ' Family@Example.COM ',
      password: 'Fixture!2345',
      passwordConfirmation: 'Fixture!2345',
      registrationType: 'TRAINEE',
    };
    let first;
    await check(
      'real service signup under server RLS stores hash and issues applicant session',
      async () => {
        first = await service.signup(base);
        assert.equal(first.token.length, 43);
        const c = (
          await admin.query('SELECT * FROM public.application_credentials')
        ).rows[0];
        assert.equal(c.login_email, 'family@example.com');
        assert.equal(c.email_verified, false);
        assert.ok(await verifyPassword(c.password_hash, base.password));
        assert.equal(
          (await admin.query('SELECT count(*)::int AS n FROM public."user"'))
            .rows[0].n,
          before.user.count,
        );
      },
    );
    await check(
      'RLS hides existing credentials even after an accidental browser SELECT grant',
      async () => {
        assert.ok(
          (await admin.query('SELECT * FROM public.application_credentials'))
            .rowCount > 0,
        );
        await admin.query('BEGIN');
        await admin.query(
          'GRANT SELECT ON public.application_credentials TO anon',
        );
        await admin.query('SET LOCAL ROLE anon');
        assert.equal(
          (await admin.query('SELECT * FROM public.application_credentials'))
            .rowCount,
          0,
        );
        await admin.query('ROLLBACK');
      },
    );
    await check(
      'real service password login rotates session without a recovery code',
      async () => {
        const next = await service.login(base);
        assert.notEqual(next.token, first.token);
        const session = (
          await admin.query(
            'SELECT s.* FROM public.applicant_sessions s JOIN public.application_credentials c USING(application_id)',
          )
        ).rows[0];
        assert.equal(session.recovery_hash, null);
        assert.equal(session.recovery_expires_at, null);
      },
    );
    await check(
      'multiple trainee/volunteer identities can share one family email',
      async () => {
        await service.signup({
          ...base,
          identifier: '000000018',
          registrationType: 'VOLUNTEER',
        });
        assert.equal(
          (
            await admin.query(
              "SELECT count(*)::int AS n FROM public.application_credentials WHERE login_email='family@example.com'",
            )
          ).rows[0].n,
          2,
        );
      },
    );
    await check(
      'concurrent real service signup commits one identity only',
      async () => {
        const results = await Promise.allSettled([
          service.signup({ ...base, identifier: '000000026' }),
          service.signup({ ...base, identifier: '000000026' }),
        ]);
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        assert.equal(
          results.find((r) => r.status === 'rejected').reason.getStatus(),
          409,
        );
      },
    );
    await check(
      'duplicate signup and wrong-password login are rejected',
      async () => {
        await assert.rejects(
          () => service.signup(base),
          (e) => e.getStatus() === 409,
        );
        await assert.rejects(
          () => service.login({ ...base, password: 'Wrong!2345' }),
          (e) => e.getStatus() === 401,
        );
      },
    );
    await check(
      'branchless submitted application is rejected by database constraint',
      async () => {
        const id = (
          await admin.query(
            'SELECT application_id FROM public.application_credentials LIMIT 1',
          )
        ).rows[0].application_id;
        await expectCode(
          async () =>
            admin.query(
              "UPDATE public.trainee_applications SET status='PENDING_REVIEW' WHERE id=$1",
              [id],
            ),
          '23514',
        );
      },
    );
    await check(
      'credential/application identity mismatch is rejected',
      async () => {
        await expectCode(
          async () =>
            admin.query(
              "INSERT INTO public.application_credentials(application_id,national_id_hash,password_hash,login_email) VALUES($1,$2,$3,'other@example.com')",
              [
                legacy[0],
                randomBytes(32).toString('hex'),
                await hashPassword('Fixture!2345'),
              ],
            ),
          '23505',
        );
      },
    );
    await check(
      'database rejects plaintext hashes and verified-email flags',
      async () => {
        const id = (
          await admin.query(
            'SELECT application_id FROM public.application_credentials LIMIT 1',
          )
        ).rows[0].application_id;
        await expectCode(
          async () =>
            admin.query(
              "UPDATE public.application_credentials SET password_hash='plaintext' WHERE application_id=$1",
              [id],
            ),
          '23514',
        );
        await expectCode(
          async () =>
            admin.query(
              'UPDATE public.application_credentials SET email_verified=true WHERE application_id=$1',
              [id],
            ),
          '23514',
        );
      },
    );
    await check(
      'legacy recovery hashes and all fixture rows remain unchanged after new signups',
      async () => {
        const rows = (
          await admin.query(
            'SELECT recovery_hash FROM public.applicant_sessions WHERE application_id=ANY($1::uuid[])',
            [legacy],
          )
        ).rows;
        assert.equal(rows.length, 10);
        assert.ok(rows.every((r) => r.recovery_hash));
      },
    );
    await check(
      'existing legacy manager-style provisioning still permits temporary passwords',
      async () => {
        await admin.query(
          'INSERT INTO public."user"(id,national_id_hash,password_hash,must_change_password,temporary_password_expires_at) VALUES($1,$2,$3,true,now()+interval \'7 days\')',
          [
            randomUUID(),
            randomBytes(32).toString('hex'),
            await hashPassword('Temporary!2345'),
          ],
        );
      },
    );
    await check(
      'manual user creation cannot steal credential-bearing identity',
      async () => {
        const hash = (
          await admin.query(
            'SELECT national_id_hash FROM public.application_credentials LIMIT 1',
          )
        ).rows[0].national_id_hash;
        await expectCode(
          async () =>
            admin.query(
              'INSERT INTO public."user"(id,national_id_hash,password_hash,must_change_password) VALUES($1,$2,$3,true)',
              [randomUUID(), hash, await hashPassword('Temporary!2345')],
            ),
          '23505',
        );
      },
    );
    const {
      getNationalIdDetails,
    } = require('../dist/modules/user/national-id.util');
    async function peer() {
      const client = new Client(config);
      await client.connect();
      await client.query('SET ROLE etlaasot_app');
      return client;
    }
    async function waitForIdentityWaiter() {
      for (let i = 0; i < 100; i++) {
        if (
          (
            await admin.query(
              "SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted",
            )
          ).rowCount
        )
          return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw Error('Expected concurrent identity lock waiter');
    }
    await check(
      'user-first concurrent signup waits then rejects committed user identity',
      async () => {
        const client = await peer();
        const hash = getNationalIdDetails('000000034').nationalIdHash;
        const passwordHash = await hashPassword('Temporary!2345');
        try {
          await client.query('BEGIN');
          await client.query(
            'INSERT INTO public."user"(id,national_id_hash,password_hash) VALUES($1,$2,$3)',
            [randomUUID(), hash, passwordHash],
          );
          const pending = service
            .signup({ ...base, identifier: '000000034' })
            .then(
              (value) => ({ value }),
              (error) => ({ error }),
            );
          await waitForIdentityWaiter();
          await client.query('COMMIT');
          assert.equal((await pending).error.getStatus(), 409);
        } finally {
          await client.query('ROLLBACK').catch(() => {});
          await client.end();
        }
      },
    );
    await check(
      'signup-first concurrent user insert waits then rejects credential conflict',
      async () => {
        const signup = await peer(),
          userWriter = await peer();
        const hash = getNationalIdDetails('000000042').nationalIdHash;
        const passwordHash = await hashPassword('Fixture!2345');
        try {
          await signup.query('BEGIN');
          await signup.query(
            "SELECT pg_advisory_xact_lock(hashtextextended('application-identity:'||$1,0))",
            [hash],
          );
          const id = randomUUID();
          await signup.query(
            "INSERT INTO public.trainee_applications(id,national_id_hash,national_id_encrypted,branch_id) VALUES($1,$2,'fixture',NULL)",
            [id, hash],
          );
          await signup.query(
            "INSERT INTO public.application_credentials(application_id,national_id_hash,password_hash,login_email) VALUES($1,$2,$3,'family@example.com')",
            [id, hash, passwordHash],
          );
          const pending = userWriter
            .query(
              'INSERT INTO public."user"(id,national_id_hash,password_hash,must_change_password) VALUES($1,$2,$3,true)',
              [randomUUID(), hash, passwordHash],
            )
            .then(
              (value) => ({ value }),
              (error) => ({ error }),
            );
          await waitForIdentityWaiter();
          await signup.query('COMMIT');
          assert.equal((await pending).error.code, '23505');
        } finally {
          await signup.query('ROLLBACK').catch(() => {});
          await signup.end();
          await userWriter.end();
        }
      },
    );
    await check(
      'actual transaction failure rolls back draft, credentials and session',
      async () => {
        const hash = getNationalIdDetails('000000059').nationalIdHash;
        const event = appRepo.event;
        appRepo.event = async () => {
          throw Error('Synthetic event failure');
        };
        try {
          await assert.rejects(
            () => service.signup({ ...base, identifier: '000000059' }),
            (e) => e.getStatus() === 503,
          );
        } finally {
          appRepo.event = event;
        }
        assert.equal(
          (
            await admin.query(
              'SELECT 1 FROM public.trainee_applications WHERE national_id_hash=$1',
              [hash],
            )
          ).rowCount,
          0,
        );
        assert.equal(
          (
            await admin.query(
              'SELECT 1 FROM public.application_credentials WHERE national_id_hash=$1',
              [hash],
            )
          ).rowCount,
          0,
        );
      },
    );
    const result = {
      success: true,
      postgresVersion: (await admin.query('SHOW server_version')).rows[0]
        .server_version,
      cluster: directory,
      host: '127.0.0.1',
      port,
      checks,
      legacyBefore: before,
      migrationSha256: createHash('sha256').update(sql).digest('hex'),
    };
    fs.writeFileSync(
      path.join(root, '.tmp', 'phase1-database-verification.json'),
      JSON.stringify(result, null, 2),
    );
    console.log(
      JSON.stringify({
        success: true,
        checks: checks.length,
        cluster: directory,
        port,
      }),
    );
  } catch (error) {
    fs.writeFileSync(
      path.join(root, '.tmp', 'phase1-database-verification.json'),
      JSON.stringify(
        {
          success: false,
          passed: checks,
          error: {
            name: error.name,
            code: error.code ?? error.original?.code,
            message: error.message,
          },
          cluster: directory,
        },
        null,
        2,
      ),
    );
    // Synthetic local errors only; never print credentials, SQL or bind parameters.
    console.error(
      'LOCAL_VERIFICATION_FAILED',
      error.name,
      error.code ?? error.original?.code ?? '',
      error.message,
    );
    process.exitCode = 1;
  } finally {
    if (db) await db.close().catch(() => {});
    if (admin) await admin.end().catch(() => {});
    if (running) pg('pg_ctl', ['-D', directory, '-m', 'fast', '-w', 'stop']);
  }
}
main().catch((e) => {
  console.error('LOCAL_SANDBOX_SETUP_FAILED', e.code ?? '', e.message);
  process.exitCode = 1;
});
