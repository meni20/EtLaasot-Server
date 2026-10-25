// Creates a fresh, loopback-only PostgreSQL cluster containing synthetic data.
// Never loads .env, AppModule, application connection settings or cloud clients.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const root = path.resolve(__dirname, '..');
const bin = 'C:/Program Files/PostgreSQL/17/bin';
const cleanEnv = Object.fromEntries(
  [
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
  ]
    .filter((k) => process.env[k])
    .map((k) => [k, process.env[k]]),
);
function binary(name, args) {
  const result = spawnSync(path.join(bin, name), args, {
    env: cleanEnv,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60000,
  });
  if (result.status !== 0)
    throw Error(`${name} failed: ${result.stderr || result.stdout}`);
}
async function main() {
  assert.ok(
    fs.existsSync(path.join(bin, 'initdb.exe')),
    'Local PostgreSQL 17 is required',
  );
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const parent = path.join(root, '.tmp');
  fs.mkdirSync(parent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(parent, 'volunteer-phase1-'));
  const config = {
    host: '127.0.0.1',
    port,
    user: 'phase1_test',
    database: 'postgres',
    ssl: false,
  };
  let started = false,
    client,
    db;
  try {
    binary('initdb.exe', [
      '-D',
      directory,
      '-U',
      'phase1_test',
      '-A',
      'trust',
      '--encoding=UTF8',
      '--no-locale',
    ]);
    binary('pg_ctl.exe', [
      '-D',
      directory,
      '-l',
      path.join(directory, 'server.log'),
      '-o',
      `-h 127.0.0.1 -p ${port}`,
      '-w',
      'start',
    ]);
    started = true;
    client = new Client(config);
    await client.connect();
    const location = (await client.query('SHOW data_directory')).rows[0]
      .data_directory;
    assert.equal(
      fs.realpathSync(location),
      fs.realpathSync(directory),
      'Fresh local cluster identity',
    );
    await client.query(
      'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE etlaasot_app;',
    );
    await client.query(
      fs.readFileSync(
        path.join(root, 'test/parent-registration/baseline.sql'),
        'utf8',
      ),
    );
    await client.query(
      'CREATE UNIQUE INDEX user_identity_unique ON "user"(national_id_hash)',
    );
    for (const name of [
      '030_parent_registration.sql',
      '031_parent_applications.sql',
      '032_registration_medical_image_mime.sql',
    ])
      await client.query(
        fs.readFileSync(path.join(root, 'migrations', name), 'utf8'),
      );
    await client.query(
      "INSERT INTO branch(id,name) VALUES('branch-a','Fictional local branch')",
    );
    const oldApp = randomUUID(),
      oldVersion = randomUUID(),
      oldEvidence = randomUUID();
    await client.query(
      "INSERT INTO trainee_applications(id,national_id_hash,national_id_encrypted,branch_id) VALUES($1,$2,'fictional','branch-a')",
      [oldApp, 'a'.repeat(64)],
    );
    await client.query(
      "INSERT INTO trainee_application_versions(id,application_id,version_number,submitted_revision,idempotency_key,form_data,content_hash,declarations,declaration_version,template_version) VALUES($1,$2,1,0,$3,'{}',$4,$5,'v1','v1')",
      [
        oldVersion,
        oldApp,
        randomUUID(),
        'b'.repeat(64),
        JSON.stringify(Array(10).fill('fictional')),
      ],
    );
    await client.query(
      "INSERT INTO trainee_application_evidence(id,application_id,version_id,kind,storage_bucket,storage_path,mime_type,file_size,checksum,content_hash,verified_at) VALUES($1,$2,$3,'SIGNATURE','private','fictional','image/png',10,$4,$4,now())",
      [oldEvidence, oldApp, oldVersion, 'c'.repeat(64)],
    );
    const before = (
      await client.query(
        'SELECT form_data,declarations,content_hash FROM trainee_application_versions WHERE id=$1',
        [oldVersion],
      )
    ).rows[0];
    await client.query(
      fs.readFileSync(
        path.join(root, 'migrations/033_application_registration_types.sql'),
        'utf8',
      ),
    );
    assert.deepEqual(
      (
        await client.query(
          'SELECT form_data,declarations,content_hash FROM trainee_application_versions WHERE id=$1',
          [oldVersion],
        )
      ).rows[0],
      before,
    );
    assert.equal(
      (
        await client.query(
          'SELECT registration_type FROM trainee_applications WHERE id=$1',
          [oldApp],
        )
      ).rows[0].registration_type,
      'TRAINEE',
    );
    assert.equal(
      (
        await client.query(
          'SELECT registration_type,signature_purpose FROM trainee_application_evidence WHERE id=$1',
          [oldEvidence],
        )
      ).rows[0].signature_purpose,
      null,
    );
    await assert.rejects(
      client.query(
        "UPDATE trainee_application_versions SET form_data='{}' WHERE id=$1",
        [oldVersion],
      ),
      /immutable/,
    );
    await assert.rejects(
      client.query('DELETE FROM trainee_application_evidence WHERE id=$1', [
        oldEvidence,
      ]),
      /immutable/,
    );
    const vol = randomUUID();
    await client.query(
      "INSERT INTO trainee_applications(id,national_id_hash,national_id_encrypted,branch_id,registration_type) VALUES($1,$2,'fictional','branch-a','VOLUNTEER')",
      [vol, 'd'.repeat(64)],
    );
    await assert.rejects(
      client.query(
        "INSERT INTO trainee_applications(national_id_hash,national_id_encrypted,branch_id,registration_type) VALUES($1,'fictional','branch-a','VOLUNTEER')",
        ['a'.repeat(64)],
      ),
      /unique/,
    );
    await assert.rejects(
      client.query(
        "INSERT INTO trainee_application_versions(application_id,version_number,submitted_revision,idempotency_key,form_data,content_hash,declarations,declaration_version,template_version) VALUES($1,1,0,$2,'{}',$3,$4,'v1','v1')",
        [
          vol,
          randomUUID(),
          'e'.repeat(64),
          JSON.stringify(Array(10).fill('x')),
        ],
      ),
      /foreign key/,
    );
    await client.query(
      "INSERT INTO trainee_application_versions(application_id,registration_type,version_number,submitted_revision,idempotency_key,form_data,content_hash,declarations,declaration_version,template_version) VALUES($1,'VOLUNTEER',1,0,$2,'{}',$3,$4,'future','future')",
      [vol, randomUUID(), 'e'.repeat(64), JSON.stringify(['future agreement'])],
    );
    await assert.rejects(
      client.query(
        "INSERT INTO trainee_application_versions(application_id,version_number,submitted_revision,idempotency_key,form_data,content_hash,declarations,declaration_version,template_version) VALUES($1,2,0,$2,'{}',$3,'[\"wrong count\"]','v1','v1')",
        [oldApp, randomUUID(), 'e'.repeat(64)],
      ),
      /check constraint/,
    );
    const insertEvidence = (owner, type, kind, mime, purpose) =>
      client.query(
        "INSERT INTO trainee_application_evidence(application_id,registration_type,kind,storage_bucket,storage_path,mime_type,file_size,checksum,content_hash,verified_at,signature_purpose) VALUES($1,$2,$3,'private',$4,$5,10,$6,$6,now(),$7)",
        [owner, type, kind, randomUUID(), mime, 'f'.repeat(64), purpose],
      );
    await insertEvidence(
      vol,
      'VOLUNTEER',
      'POLICE_CLEARANCE',
      'application/pdf',
      null,
    );
    await insertEvidence(
      vol,
      'VOLUNTEER',
      'SIGNATURE',
      'image/png',
      'CONFIDENTIALITY',
    );
    await assert.rejects(
      insertEvidence(vol, 'VOLUNTEER', 'SIGNATURE', 'image/png', null),
      /check constraint/,
    );
    await assert.rejects(
      insertEvidence(
        oldApp,
        'TRAINEE',
        'POLICE_CLEARANCE',
        'application/pdf',
        null,
      ),
      /check constraint/,
    );
    await assert.rejects(
      insertEvidence(vol, 'VOLUNTEER', 'POLICE_CLEARANCE', 'image/png', null),
      /check constraint/,
    );
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await client.query(`SET ROLE ${role}`);
      await assert.rejects(
        client.query('SELECT * FROM trainee_applications'),
        /permission denied/,
      );
      await client.query('RESET ROLE');
    }
    await client.query('SET ROLE etlaasot_app');
    assert.equal(
      (await client.query('SELECT count(*) FROM trainee_applications')).rows[0]
        .count,
      '2',
    );
    await assert.rejects(
      client.query(
        "UPDATE trainee_application_versions SET declaration_version='bad'",
      ),
      /permission denied/,
    );
    await client.query('RESET ROLE');
    console.log(
      'PASS: migration defaults, immutable historical data, type FKs, uniqueness, declarations, evidence, RLS/ACLs',
    );

    require('ts-node').register({
      transpileOnly: true,
      compilerOptions: {
        module: 'CommonJS',
        moduleResolution: 'node',
        resolvePackageJsonExports: false,
      },
    });
    require('tsconfig-paths/register');
    require('reflect-metadata');
    process.env.NATIONAL_ID_HASH_SECRET = 'fictional-local-phase1-only';
    process.env.NATIONAL_ID_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    const { Sequelize } = require('sequelize-typescript');
    const { Model } = require('sequelize');
    const models = [];
    function visit(dir) {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, item.name);
        if (item.isDirectory()) visit(file);
        else if (item.name.endsWith('.entity.ts'))
          for (const value of Object.values(require(file)))
            if (typeof value === 'function' && value.prototype instanceof Model)
              models.push(value);
      }
    }
    visit(path.join(root, 'src/modules'));
    db = new Sequelize({
      dialect: 'postgres',
      host: config.host,
      port: config.port,
      username: config.user,
      database: config.database,
      logging: false,
      models,
    });
    db.addModels(
      require('../src/modules/parent-admission/admission.entities')
        .ADMISSION_MODELS,
    );
    const {
      AdmissionRepository,
    } = require('../src/modules/parent-admission/admission.repository');
    const repo = new AdmissionRepository(db);
    assert.equal((await repo.list(['branch-a'], 1)).count, 1);
    assert.equal((await repo.list(['branch-a'], 1, 'VOLUNTEER')).count, 1);
    assert.equal((await repo.list(['other-branch'], 1, 'VOLUNTEER')).count, 0);
    console.log(
      'PASS: repository type and branch isolation with legacy default',
    );
    const UserService = require('../src/modules/user/user.service').default;
    const UserRepository =
      require('../src/modules/user/user.repository').default;
    const RoleService =
      require('../src/modules/user-role/user-role.service').default;
    const RoleRepository =
      require('../src/modules/user-role/user-role.repositroy').default;
    const service = new UserService(
      db,
      new UserRepository(),
      new RoleService(new RoleRepository()),
    );
    const input = {
      id: '123456782',
      name: 'Fictional isolated test',
      phoneNumber: '0500000000',
      dateOfBirth: '2000-01-01',
      branchId: 'branch-a',
    };
    // Missing VOLUNTEER role forces a real database FK failure after user insertion.
    await assert.rejects(service.createUserWithRole(input));
    assert.equal(
      (await client.query('SELECT count(*) FROM "user"')).rows[0].count,
      '0',
    );
    await client.query("INSERT INTO roles(id,name) VALUES(1,'VOLUNTEER')");
    await assert.rejects(
      db.transaction(async (t) => {
        await service.createUserWithRole(input, t);
        throw Error('synthetic approval failure');
      }),
      /synthetic approval failure/,
    );
    assert.equal(
      (await client.query('SELECT count(*) FROM "user"')).rows[0].count,
      '0',
    );
    assert.equal(
      (await client.query('SELECT count(*) FROM user_roles')).rows[0].count,
      '0',
    );
    const result = await service.createUserWithRole(input);
    assert.equal(result.user.mustChangePassword, true);
    assert.equal(result.temporaryPassword.length, 18);
    const row = (
      await client.query(
        'SELECT "roleId","resourceId" FROM user_roles WHERE "userId"=$1',
        [result.user.id],
      )
    ).rows[0];
    assert.deepEqual(row, { roleId: 1, resourceId: 'branch-a' });
    console.log(
      'PASS: real PostgreSQL volunteer provisioning, role-failure rollback, caller-transaction rollback, legacy standalone creation',
    );
    if (process.argv.includes('--phase2'))
      await require('./volunteer-phase2-local-checks.cjs')({
        client,
        db,
        root,
        users: service,
      });
  } finally {
    if (db) await db.close();
    if (client) await client.end();
    if (started)
      binary('pg_ctl.exe', ['-D', directory, '-m', 'fast', '-w', 'stop']);
    console.log(
      'Fresh local cluster stopped; synthetic files retained under .tmp. No remote connections.',
    );
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
