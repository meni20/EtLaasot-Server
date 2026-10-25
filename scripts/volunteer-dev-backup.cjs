const {
  status,
  variables,
  assertDb,
  databaseConfig,
} = require('./volunteer-dev-target.cjs');
const { Client } = require('pg');
const fs = require('node:fs'),
  path = require('node:path'),
  { spawnSync } = require('node:child_process'),
  { createHash } = require('node:crypto');
(async () => {
  status();
  const v = variables('server');
  assertDb(v);
  const config = databaseConfig(v),
    db = new Client(config);
  await db.connect();
  try {
    const id = (
      await db.query(
        "SELECT current_database()='postgres' AND current_user='etlaasot_app' AS ok, (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS pooled_backend_tls",
      )
    ).rows[0];
    if (!id.ok || !db.connection.stream.encrypted)
      throw Error('DATABASE_ATTESTATION_FAILED');
    const dir = path.resolve(
      __dirname,
      '../.tmp/volunteer-phase5-backup-' + Date.now(),
    );
    fs.mkdirSync(dir, { recursive: true });
    const acl = spawnSync(
      'icacls.exe',
      [
        dir,
        '/inheritance:r',
        '/grant:r',
        `${process.env.USERDOMAIN}\\${process.env.USERNAME}:(OI)(CI)F`,
        'SYSTEM:(OI)(CI)F',
      ],
      { windowsHide: true, stdio: 'pipe' },
    );
    if (acl.status !== 0) throw Error('PRIVATE_BACKUP_ACL_FAILED');
    const ca = path.join(dir, 'ca.pem');
    if (config.ssl.ca) fs.writeFileSync(ca, config.ssl.ca, { mode: 0o600 });
    const file = path.join(dir, 'supabase-dev-public.dump'),
      bin = 'C:/Program Files/PostgreSQL/17/bin';
    const env = {
      ...process.env,
      PGHOST: config.host,
      PGPORT: String(config.port),
      PGUSER: config.user,
      PGPASSWORD: config.password,
      PGDATABASE: config.database,
      PGSSLMODE: 'verify-full',
      ...(config.ssl.ca ? { PGSSLROOTCERT: ca } : {}),
    };
    const dump = spawnSync(
      path.join(bin, 'pg_dump.exe'),
      [
        '--format=custom',
        '--schema=public',
        '--enable-row-security',
        '--file',
        file,
      ],
      {
        env,
        windowsHide: true,
        encoding: 'utf8',
        timeout: 120000,
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    if (dump.status !== 0) {
      console.error(
        'BACKUP_FAILURE_CATEGORY',
        dump.stderr?.includes('permission denied')
          ? 'PERMISSION'
          : dump.stderr?.includes('row-level security')
            ? 'RLS'
            : dump.stderr?.includes('SSL')
              ? 'TLS'
              : 'OTHER',
      );
      throw Error('BACKUP_FAILED');
    }
    const verify = spawnSync(
      path.join(bin, 'pg_restore.exe'),
      ['--file=-', file],
      { windowsHide: true, timeout: 60000, stdio: 'ignore' },
    );
    if (verify.status !== 0) throw Error('BACKUP_RESTORE_STREAM_VERIFY_FAILED');
    const toc = spawnSync(path.join(bin, 'pg_restore.exe'), ['--list', file], {
      windowsHide: true,
      encoding: 'utf8',
    });
    if (toc.status !== 0) throw Error('BACKUP_TOC_FAILED');
    const tables = (
      await db.query(
        "select tablename from pg_tables where schemaname='public' order by tablename",
      )
    ).rows.map((r) => r.tablename);
    const counts = {};
    for (const table of tables) {
      const quoted = '"' + table.replaceAll('"', '""') + '"';
      counts[table] = Number(
        (await db.query('SELECT count(*) FROM public.' + quoted)).rows[0].count,
      );
      if (!toc.stdout.includes('TABLE DATA public ' + table + ' '))
        throw Error('BACKUP_TABLE_MISSING');
    }
    const bytes = fs.readFileSync(file),
      sha256 = createHash('sha256').update(bytes).digest('hex');
    const manifest = {
      project: 'vlysppqfozfiwcmsyban',
      createdAt: new Date().toISOString(),
      file,
      bytes: bytes.length,
      sha256,
      tableCounts: counts,
      archiveDecoded: true,
      tlsVerified: true,
      grantsRlsSchemaIncluded: true,
    };
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      { mode: 0o600 },
    );
    fs.writeFileSync(
      path.resolve(
        __dirname,
        '../.tmp/volunteer-phase5-backup-manifest-path.txt',
      ),
      path.join(dir, 'manifest.json'),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        status: 'VERIFIED_DEV_PUBLIC_BACKUP',
        manifest: path.join(dir, 'manifest.json'),
        bytes: bytes.length,
        sha256,
        tableCount: tables.length,
        affectedTableCounts: Object.fromEntries(
          Object.entries(counts).filter(([k]) =>
            k.startsWith('trainee_application'),
          ),
        ),
      }),
    );
  } finally {
    await db.end();
  }
})().catch((e) => {
  console.error(
    e.code ||
      (/^[A-Z_]+$/.test(e.message)
        ? e.message
        : 'DEV_BACKUP_OR_CONNECTION_FAILED'),
  );
  process.exitCode = 1;
});
