// Creates only visibly marked fictional test fixtures in the attested DEV DB.
// No schema changes, updates, resets or deletes. Secrets stay in the protected
// ignored local configuration directory. No normal migration runner is invoked.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  { randomUUID, randomInt } = require('node:crypto'),
  { Client } = require('pg');
const { attest, file, dir, root } = require('./phase5-local.cjs');
const credentials = path.join(dir, 'fixtures.json'),
  baseline = path.join(dir, 'baseline.json');
function identifier() {
  const base = String(randomInt(70000000, 79999999));
  const n = [...base].reduce((s, c, i) => {
    let x = Number(c) * ((i % 2) + 1);
    return s + (x > 9 ? x - 9 : x);
  }, 0);
  return base + ((10 - (n % 10)) % 10);
}
async function fingerprints(c) {
  const out = {};
  const tables = (
    await c.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    )
  ).rows;
  for (const { tablename: n } of tables) {
    const quoted = '"' + n.replaceAll('"', '""') + '"';
    out[n] = (
      await c.query(
        `SELECT md5(to_jsonb(t)::text) AS h FROM public.${quoted} t ORDER BY h`,
      )
    ).rows.map((r) => r.h);
  }
  return out;
}
async function run() {
  if (!['--execute', '--verify'].includes(process.argv[2])) {
    console.log(
      'PLAN ONLY: --execute creates two fictional branches, two admins, one existing trainee and an activity year only if none is active. --verify checks all pre-existing row fingerprints. No cleanup is automatic.',
    );
    return;
  }
  const config = JSON.parse(fs.readFileSync(file, 'utf8')),
    v = config.env;
  await attest(v);
  Object.assign(process.env, v);
  const c = new Client({
    host: v.DB_HOST,
    port: 5432,
    database: 'postgres',
    user: v.DB_USER,
    password: v.DB_PASS,
    ssl: {
      rejectUnauthorized: true,
      ca: fs.readFileSync(path.resolve(root, v.DB_SSL_CA_PATH), 'utf8'),
    },
    connectionTimeoutMillis: 12000,
  });
  try {
    await c.connect();
    await c.query(process.argv[2] === '--verify' ? 'BEGIN READ ONLY' : 'BEGIN');
    const ok = (
      await c.query(
        "SELECT current_database()='postgres' AND current_user='etlaasot_app' AND inet_server_addr()='2a05:d014:8ef:5902:b67d:7199:8fac:e6d0'::inet AND inet_server_port()=5432 AS ok",
      )
    ).rows[0];
    assert.equal(ok.ok, true);
    assert.equal(c.connection.stream.authorized, true);
    if (process.argv[2] === '--verify') {
      const before = JSON.parse(fs.readFileSync(baseline, 'utf8')),
        after = await fingerprints(c);
      for (const [table, rows] of Object.entries(before)) {
        const counts = new Map();
        for (const h of after[table] ?? [])
          counts.set(h, (counts.get(h) ?? 0) + 1);
        for (const h of rows) {
          assert.ok(
            counts.get(h) > 0,
            'A pre-existing row changed in ' + table,
          );
          counts.set(h, counts.get(h) - 1);
        }
      }
      await c.query('COMMIT');
      console.log(
        JSON.stringify({
          existingRecordsUnchanged: true,
          tablesChecked: Object.keys(before).length,
        }),
      );
      return;
    }
    if (fs.existsSync(credentials))
      throw Error('Fixture manifest exists; refusing duplicate seeding');
    fs.writeFileSync(baseline, JSON.stringify(await fingerprints(c)), {
      mode: 0o600,
    });
    for (const id of config.branches) {
      assert.ok(id.startsWith('phase5-'));
      const exists = (
        await c.query('SELECT 1 FROM public.branch WHERE id=$1', [id])
      ).rowCount;
      assert.equal(exists, 0);
      await c.query(
        'INSERT INTO public.branch(id,name,city,"isActive","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())',
        [id, 'בדיקת Phase5 ' + id, 'עיר בדיקה'],
      );
    }
    let year = (
      await c.query(
        'SELECT id FROM public.activity_years WHERE is_active AND current_date BETWEEN starts_on AND ends_on',
      )
    ).rows[0];
    if (!year) {
      assert.equal(
        (await c.query('SELECT 1 FROM public.activity_years WHERE is_active'))
          .rowCount,
        0,
        'An existing activity year requires review',
      );
      year = { id: randomUUID() };
      const yyyy = new Date().getUTCFullYear();
      await c.query(
        'INSERT INTO public.activity_years(id,name,starts_on,ends_on,is_active) VALUES($1,$2,$3,$4,true)',
        [
          year.id,
          'Phase5 fictional ' + config.suffix,
          `${yyyy}-01-01`,
          `${yyyy}-12-31`,
        ],
      );
    }
    const {
        getNationalIdDetails,
      } = require('../dist/modules/user/national-id.util'),
      {
        encryptNationalId,
      } = require('../dist/modules/user/national-id-encryption.util'),
      {
        generateTemporaryPassword,
        getTemporaryPasswordExpiry,
        hashPassword,
      } = require('../dist/modules/auth/password.util');
    const users = [];
    for (const [index, roleId] of [10000, 10000, 2].entries()) {
      const nationalId = identifier(),
        identity = getNationalIdDetails(nationalId),
        id = randomUUID(),
        password = generateTemporaryPassword(),
        branchId = config.branches[index === 1 ? 1 : 0];
      assert.equal(
        (
          await c.query(
            'SELECT 1 FROM public."user" WHERE national_id_hash=$1',
            [identity.nationalIdHash],
          )
        ).rowCount,
        0,
        'Fictional ID collides; no records overwritten',
      );
      await c.query(
        'INSERT INTO public."user"(id,name,phone_number,"branchId",is_active,national_id_hash,national_id_last4,national_id_encrypted,password_hash,must_change_password,temporary_password_expires_at,"createdAt","updatedAt") VALUES($1,$2,$3,$4,true,$5,$6,$7,$8,$9,$10,now(),now())',
        [
          id,
          'Phase5 fictional ' +
            (roleId === 2 ? 'trainee' : 'admin') +
            ' ' +
            config.suffix,
          '0500000000',
          branchId,
          identity.nationalIdHash,
          identity.normalizedNationalId.slice(-4),
          encryptNationalId(identity.normalizedNationalId),
          await hashPassword(password),
          true,
          getTemporaryPasswordExpiry(),
        ],
      );
      await c.query(
        'INSERT INTO public.user_roles("userId","roleId","resourceId","createdAt","updatedAt") VALUES($1,$2,$3,now(),now())',
        [id, roleId, branchId],
      );
      users.push({
        id,
        nationalId,
        roleId,
        branchId,
        password,
        newPassword: generateTemporaryPassword(),
      });
    }
    await c.query('COMMIT');
    fs.writeFileSync(
      credentials,
      JSON.stringify({
        marker: config.suffix,
        branches: config.branches,
        yearId: year.id,
        users,
      }),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        created: true,
        fictionalBranches: 2,
        fictionalUsers: 3,
        fixtureMarker: config.suffix,
        passwordsPrinted: false,
      }),
    );
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error(
      JSON.stringify({
        failed: true,
        code: e.code || e.name,
        message:
          e.name === 'AssertionError'
            ? e.message
            : 'Fixture operation stopped; no credential details logged',
      }),
    );
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}
run().catch(() => {
  console.error('Fixture setup stopped safely.');
  process.exitCode = 1;
});
