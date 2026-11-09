import { assertApplicantPasswordFeature } from './application-credentials.feature';
const original = { ...process.env };
const production = () => ({
  NODE_ENV: 'production',
  BRANCH_NAME: 'main',
  RAILWAY_PROJECT_ID: 'e950a261-d932-48c2-bc19-86287cb374ef',
  RAILWAY_ENVIRONMENT_ID: 'b5bc66a8-10fd-45ac-af6b-99a84c84a338',
  RAILWAY_ENVIRONMENT_NAME: 'main',
  RAILWAY_SERVICE_ID: '0172d945-f6bf-43ae-8ccb-dc4cf318604b',
  SUPABASE_URL: 'https://tmlnuqrwhdeplpeuuvwv.supabase.co',
  DB_USER: 'etlaasot_app.tmlnuqrwhdeplpeuuvwv',
  DB_HOST: 'aws-1-eu-central-1.pooler.supabase.com',
  DB_PORT: '5432',
  DB_NAME: 'postgres',
  DB_SSL: 'true',
  DB_SSL_REJECT_UNAUTHORIZED: 'true',
  DB_SSL_CA_PATH: 'certs/supabase-prod-ca-2021.crt',
  DB_SYNC: 'false',
  DB_LOGGING: 'false',
  APPLICANT_PASSWORD_AUTH_ENABLED: 'true',
  APPLICANT_REGISTRATION_ENABLED: 'true',
  PARENT_ADMISSION_SCHEMA_READY: 'true',
  APPLICATION_CREDENTIALS_SCHEMA_READY: 'true',
  REGISTRATION_DOCUMENTS_URL: 'http://etlaasot-documents.railway.internal:3000',
  PUBLIC_CLIENT_ORIGIN: 'https://etlaasot-client-main-main.up.railway.app',
  SUPABASE_SERVICE_ROLE_KEY:
    'x.' +
    Buffer.from(
      JSON.stringify({
        ref: 'tmlnuqrwhdeplpeuuvwv',
        role: 'service_role',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url') +
    '.x',
});
afterEach(() => {
  process.env = { ...original };
});
it('allows explicitly attested Production with its own resources', () => {
  process.env = production();
  expect(() => assertApplicantPasswordFeature()).not.toThrow();
});
it.each([
  ['DB_USER', 'etlaasot_app.vlysppqfozfiwcmsyban'],
  ['SUPABASE_URL', 'https://vlysppqfozfiwcmsyban.supabase.co'],
  ['DB_HOST', 'aws-0-eu-central-1.pooler.supabase.com'],
  ['RAILWAY_ENVIRONMENT_ID', '6b2b0ac3-9131-454c-9a42-4df26937f521'],
  ['RAILWAY_SERVICE_ID', '019690d4-5b69-4bff-b685-69c84053f85e'],
  ['REGISTRATION_DOCUMENTS_URL', 'https://example.com'],
  ['DB_SSL_CA_PATH', ''],
  ['DB_SSL_REJECT_UNAUTHORIZED', 'false'],
  ['APPLICANT_PASSWORD_AUTH_ENABLED', 'false'],
  ['SUPABASE_SERVICE_ROLE_KEY', ''],
  ['PUBLIC_CLIENT_ORIGIN', 'https://etlaasot-client-dev-dev.up.railway.app'],
])('rejects missing or crossed Production %s', (key, value) => {
  process.env = { ...production(), [key]: value };
  expect(() => assertApplicantPasswordFeature()).toThrow();
});
