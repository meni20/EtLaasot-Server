type Environment = Record<string, string | undefined>;
const PROJECT = 'e950a261-d932-48c2-bc19-86287cb374ef';
const DEV = {
  name: 'dev',
  ref: 'vlysppqfozfiwcmsyban',
  host: 'aws-0-eu-central-1.pooler.supabase.com',
  environmentId: '6b2b0ac3-9131-454c-9a42-4df26937f521',
  serviceId: '019690d4-5b69-4bff-b685-69c84053f85e',
} as const;
const PRODUCTION = {
  name: 'production',
  ref: 'tmlnuqrwhdeplpeuuvwv',
  host: 'aws-1-eu-central-1.pooler.supabase.com',
  environmentId: 'b5bc66a8-10fd-45ac-af6b-99a84c84a338',
  serviceId: '0172d945-f6bf-43ae-8ccb-dc4cf318604b',
} as const;

export const isVerifiedRailwayDevRuntime = (env: Environment = process.env) =>
  env.NODE_ENV === 'development' &&
  env.BRANCH_NAME === 'dev' &&
  env.RAILWAY_PROJECT_ID === PROJECT &&
  env.RAILWAY_ENVIRONMENT_ID === DEV.environmentId &&
  env.RAILWAY_ENVIRONMENT_NAME === 'dev' &&
  (!env.RAILWAY_SERVICE_ID || env.RAILWAY_SERVICE_ID === DEV.serviceId);

export const isVerifiedRailwayProductionRuntime = (
  env: Environment = process.env,
) =>
  env.NODE_ENV === 'production' &&
  env.BRANCH_NAME === 'main' &&
  env.RAILWAY_PROJECT_ID === PROJECT &&
  env.RAILWAY_ENVIRONMENT_ID === PRODUCTION.environmentId &&
  env.RAILWAY_ENVIRONMENT_NAME === 'main' &&
  env.RAILWAY_SERVICE_ID === PRODUCTION.serviceId;

const isLocalDevelopment = (env: Environment) =>
  env.NODE_ENV === 'development' &&
  !env.RAILWAY_ENVIRONMENT_ID &&
  !env.RAILWAY_PROJECT_ID &&
  !env.RAILWAY_SERVICE_ID;

function target(env: Environment) {
  if (isVerifiedRailwayProductionRuntime(env)) return PRODUCTION;
  if (isVerifiedRailwayDevRuntime(env) || isLocalDevelopment(env)) return DEV;
  return null;
}

function serviceRoleKeyMatches(value: string | undefined, ref: string) {
  if (!value) return false;
  try {
    const parts = value.split('.');
    if (parts.length !== 3) return false;
    const claims = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    );
    return (
      claims.ref === ref &&
      claims.role === 'service_role' &&
      typeof claims.exp === 'number' &&
      claims.exp * 1000 > Date.now()
    );
  } catch {
    return false;
  }
}

// Shape/ref/expiry validation is a preflight, not JWT signature verification.
// Storage authenticates the actual server-only key against the pinned project.
export const isExpectedDevServiceRoleKey = (value: string | undefined) =>
  serviceRoleKeyMatches(value, DEV.ref);

export function hasExpectedRegistrationConfiguration(
  env: Environment = process.env,
) {
  const expected = target(env);
  const disabled = (value: string | undefined) =>
    !value?.trim() || ['false', '0', 'no'].includes(value.trim().toLowerCase());
  if (!disabled(env.DB_SYNC) || !disabled(env.DB_LOGGING)) return false;
  const verifyTls = env.DB_SSL_REJECT_UNAUTHORIZED?.trim().toLowerCase();
  if (!expected || (verifyTls && !['true', '1', 'yes'].includes(verifyTls)))
    return false;
  if (expected === PRODUCTION && (!verifyTls || !env.DB_SSL_CA_PATH?.trim()))
    return false;
  return (
    env.SUPABASE_URL === `https://${expected.ref}.supabase.co` &&
    env.DB_HOST === expected.host &&
    env.DB_PORT === '5432' &&
    env.DB_NAME === 'postgres' &&
    env.DB_USER === `etlaasot_app.${expected.ref}` &&
    env.DB_SSL === 'true' &&
    serviceRoleKeyMatches(env.SUPABASE_SERVICE_ROLE_KEY, expected.ref)
  );
}

export function isAllowedDocumentsBaseUrl(
  value: string,
  env: Environment = process.env,
) {
  if (!target(env)) return false;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'http:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      return false;
    if (isLocalDevelopment(env))
      return ['127.0.0.1', 'localhost'].includes(url.hostname);
    // Railway private DNS is scoped to the attested environment. Never use a
    // public Documents endpoint or an environment-crossing proxy/domain.
    return (
      url.hostname === 'etlaasot-documents.railway.internal' &&
      url.port === '3000'
    );
  } catch {
    return false;
  }
}
