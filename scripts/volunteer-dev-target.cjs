// DEV-only operational helpers. Never load .env or print credentials.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'),
  path = require('node:path');
const PROJECT = 'e950a261-d932-48c2-bc19-86287cb374ef',
  ENVIRONMENT = '6b2b0ac3-9131-454c-9a42-4df26937f521',
  REF = 'vlysppqfozfiwcmsyban';
const SERVICES = {
  server: '019690d4-5b69-4bff-b685-69c84053f85e',
  client: 'd8e6a080-0fc7-4cf6-af49-420d4b6fe42d',
  documents: 'fbe3e1b5-c9ad-4f64-9497-6283c570237f',
};
const railway =
  'C:/Users/User/AppData/Roaming/npm/node_modules/@railway/cli/bin/railway.exe';
function run(args, input) {
  return execFileSync(railway, args, {
    encoding: 'utf8',
    input,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 45000,
    maxBuffer: 20 * 1024 * 1024,
  });
}
function status() {
  const p = JSON.parse(
    run([
      'status',
      '--project',
      PROJECT,
      '--environment',
      ENVIRONMENT,
      '--json',
    ]),
  );
  const e = p.environments.edges
    .map((e) => e.node)
    .find((e) => e.id === ENVIRONMENT);
  if (p.id !== PROJECT || e?.name !== 'dev')
    throw Error('DEV_RAILWAY_IDENTITY_MISMATCH');
  for (const [kind, serviceId] of Object.entries(SERVICES)) {
    const instance = e.serviceInstances.edges
      .map((x) => x.node)
      .find((x) => x.serviceId === serviceId);
    const repo = `meni20/EtLaasot-${kind === 'server' ? 'Server' : kind === 'client' ? 'Client' : 'Documents'}`;
    if (
      !instance ||
      instance.source?.repo !== repo ||
      instance.latestDeployment?.meta?.branch !== 'dev'
    )
      throw Error('DEV_SERVICE_SOURCE_MISMATCH');
  }
  return { project: p, environment: e };
}
function variables(service) {
  if (!SERVICES[service]) throw Error('UNKNOWN_SERVICE');
  return JSON.parse(
    run([
      'variable',
      'list',
      '--project',
      PROJECT,
      '--environment',
      ENVIRONMENT,
      '--service',
      SERVICES[service],
      '--json',
    ]),
  );
}
function assertDb(v) {
  if (
    v.SUPABASE_URL !== `https://${REF}.supabase.co` ||
    v.DB_HOST !== 'aws-0-eu-central-1.pooler.supabase.com' ||
    v.DB_USER !== `etlaasot_app.${REF}` ||
    v.DB_NAME !== 'postgres' ||
    v.DB_SSL !== 'true' ||
    v.DB_SSL_REJECT_UNAUTHORIZED !== 'true' ||
    v.DB_SYNC === 'true' ||
    v.DB_LOGGING === 'true'
  )
    throw Error('DEV_DATABASE_IDENTITY_OR_TLS_MISMATCH');
  let claims;
  try {
    claims = JSON.parse(
      Buffer.from(
        v.SUPABASE_SERVICE_ROLE_KEY.split('.')[1],
        'base64url',
      ).toString(),
    );
  } catch {
    throw Error('DEV_STORAGE_CREDENTIAL_MISMATCH');
  }
  if (
    claims.ref !== REF ||
    claims.role !== 'service_role' ||
    claims.exp * 1000 <= Date.now()
  )
    throw Error('DEV_STORAGE_CREDENTIAL_MISMATCH');
}
function devFile() {
  if (!fs.existsSync(path.resolve(__dirname, '../.env.development.local')))
    return {};
  const text = fs.readFileSync(
    path.resolve(__dirname, '../.env.development.local'),
    'utf8',
  );
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((l) => /^[A-Za-z_][A-Za-z_0-9]*=/.test(l))
      .map((l) => {
        const i = l.indexOf('=');
        let s = l.slice(i + 1).trim();
        if (
          (s.startsWith('"') && s.endsWith('"')) ||
          (s.startsWith("'") && s.endsWith("'"))
        )
          s = s.slice(1, -1);
        return [l.slice(0, i), s];
      }),
  );
}
function databaseConfig(v) {
  assertDb(v);
  const certPath = v.DB_SSL_CA_PATH;
  const ca = certPath
    ? fs.readFileSync(
        path.resolve(__dirname, '..', certPath.replace(/^\/app\//, '')),
        'utf8',
      )
    : undefined;
  return {
    host: v.DB_HOST,
    port: Number(v.DB_PORT || 5432),
    user: v.DB_USER,
    password: v.DB_PASS,
    database: v.DB_NAME,
    ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    connectionTimeoutMillis: 15000,
  };
}
module.exports = {
  PROJECT,
  ENVIRONMENT,
  REF,
  SERVICES,
  railway,
  run,
  status,
  variables,
  assertDb,
  devFile,
  databaseConfig,
};
if (require.main === module) {
  try {
    const s = status(),
      v = variables('server'),
      c = variables('client'),
      d = variables('documents');
    assertDb(v);
    console.log(
      JSON.stringify({
        project: s.project.id,
        environment: s.environment.id,
        environmentName: s.environment.name,
        services: s.environment.serviceInstances.edges.map(({ node: n }) => ({
          id: n.serviceId,
          repo: n.source?.repo,
          branch: n.latestDeployment?.meta?.branch,
          commit: n.latestDeployment?.meta?.commitHash,
          status: n.latestDeployment?.status,
          domains: n.domains?.serviceDomains?.map((x) => x.domain),
        })),
        serverKeys: Object.keys(v).sort(),
        clientKeys: Object.keys(c).sort(),
        documentsKeys: Object.keys(d).sort(),
        checks: {
          databaseDevAndTls: true,
          documentsKeyMatches:
            !!v.REGISTRATION_DOCUMENTS_API_KEY &&
            v.REGISTRATION_DOCUMENTS_API_KEY === d.INTERNAL_API_KEY,
          documentsPrivateUrl: (() => {
            try {
              const u = new URL(v.REGISTRATION_DOCUMENTS_URL);
              return (
                u.protocol === 'http:' &&
                u.hostname === 'etlaasot-documents.railway.internal' &&
                u.port === '3000' &&
                u.pathname === '/'
              );
            } catch {
              return false;
            }
          })(),
          clientApiMatches:
            c.VITE_SERVER_URL ===
            'https://etlaasot-server-dev-dev.up.railway.app',
          serverFlagEnabled: v.VOLUNTEER_REGISTRATION_ENABLED === 'true',
          clientFlagEnabled: c.VITE_VOLUNTEER_REGISTRATION_ENABLED === 'true',
          devLocalKeys: Object.keys(devFile()).sort(),
        },
      }),
    );
  } catch (e) {
    console.error(
      e.code ||
        (/^[A-Z_]+$/.test(e.message) ? e.message : 'DEV_TARGET_CHECK_FAILED'),
    );
    process.exitCode = 1;
  }
}
