const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env');
const migrationsDir = path.join(rootDir, 'migrations');

function loadEnvFile() {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const contents = fs.readFileSync(envPath, 'utf8');

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, '');

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function getRequiredEnv(key) {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

function getBooleanEnv(key, fallback = false) {
  const value = process.env[key]?.trim().toLowerCase();
  if (!value) {
    return fallback;
  }

  if (['true', '1', 'yes'].includes(value)) {
    return true;
  }

  if (['false', '0', 'no'].includes(value)) {
    return false;
  }

  throw new Error(`Invalid boolean in environment variable ${key}: ${value}`);
}

function getClientConfig() {
  const sslEnabled = getBooleanEnv('DB_SSL', true);

  return {
    host: getRequiredEnv('DB_HOST'),
    port: Number(process.env.DB_PORT || 5432),
    user: getRequiredEnv('DB_USER'),
    password: getRequiredEnv('DB_PASS'),
    database: getRequiredEnv('DB_NAME'),
    ssl: sslEnabled
      ? { rejectUnauthorized: getBooleanEnv('DB_SSL_REJECT_UNAUTHORIZED', true) }
      : false,
  };
}

async function run() {
  loadEnvFile();

  const client = new Client(getClientConfig());
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const applied = await client.query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1',
      [file],
    );

    if (applied.rowCount) {
      console.log(`Skipping ${file}`);
      continue;
    }

    console.log(`Applying ${file}`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [file],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  await client.end();
  console.log('Migrations complete');
}

run().catch((error) => {
  console.error('Migration failed:', error.message);
  process.exit(1);
});
