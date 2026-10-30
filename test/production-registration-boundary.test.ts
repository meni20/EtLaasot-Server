import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  hasExpectedRegistrationConfiguration,
  isAllowedDocumentsBaseUrl,
  isVerifiedRailwayProductionRuntime,
} from '../src/modules/parent-registration/registration-environment.ts';

const key = (ref: string) =>
  [
    'fixture',
    Buffer.from(
      JSON.stringify({ ref, role: 'service_role', exp: 4102444800 }),
    ).toString('base64url'),
    'fixture',
  ].join('.');
const prod = () => ({
  NODE_ENV: 'production',
  BRANCH_NAME: 'main',
  RAILWAY_PROJECT_ID: 'e950a261-d932-48c2-bc19-86287cb374ef',
  RAILWAY_ENVIRONMENT_ID: 'b5bc66a8-10fd-45ac-af6b-99a84c84a338',
  RAILWAY_ENVIRONMENT_NAME: 'main',
  RAILWAY_SERVICE_ID: '0172d945-f6bf-43ae-8ccb-dc4cf318604b',
  SUPABASE_URL: 'https://tmlnuqrwhdeplpeuuvwv.supabase.co',
  DB_HOST: 'aws-1-eu-central-1.pooler.supabase.com',
  DB_PORT: '5432',
  DB_NAME: 'postgres',
  DB_USER: 'etlaasot_app.tmlnuqrwhdeplpeuuvwv',
  DB_SSL: 'true',
  DB_SSL_REJECT_UNAUTHORIZED: 'true',
  DB_SSL_CA_PATH: '/fixture/ca.pem',
  SUPABASE_SERVICE_ROLE_KEY: key('tmlnuqrwhdeplpeuuvwv'),
});

test('accepts only the pinned Production runtime/database combination', () => {
  assert.equal(isVerifiedRailwayProductionRuntime(prod()), true);
  assert.equal(hasExpectedRegistrationConfiguration(prod()), true);
  for (const [name, value] of Object.entries({
    NODE_ENV: 'development',
    BRANCH_NAME: 'dev',
    RAILWAY_PROJECT_ID: 'other',
    RAILWAY_ENVIRONMENT_ID: '6b2b0ac3-9131-454c-9a42-4df26937f521',
    RAILWAY_ENVIRONMENT_NAME: 'production',
    RAILWAY_SERVICE_ID: '',
    SUPABASE_URL: 'https://vlysppqfozfiwcmsyban.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: key('vlysppqfozfiwcmsyban'),
    DB_HOST: 'aws-0-eu-central-1.pooler.supabase.com',
    DB_USER: 'postgres.tmlnuqrwhdeplpeuuvwv',
    DB_PORT: '6543',
    DB_SSL: 'false',
    DB_SSL_REJECT_UNAUTHORIZED: '0',
    DB_SSL_CA_PATH: '',
    DB_SYNC: 'true',
    DB_LOGGING: 'true',
  }))
    assert.equal(
      hasExpectedRegistrationConfiguration({ ...prod(), [name]: value }),
      false,
      name,
    );
});

test('Production Documents permits only environment-private DNS and port', () => {
  assert.equal(
    isAllowedDocumentsBaseUrl(
      'http://etlaasot-documents.railway.internal:3000/',
      prod(),
    ),
    true,
  );
  for (const url of [
    'http://localhost:3000/',
    'http://127.0.0.1:3000/',
    'https://etlaasot-documents.railway.internal:3000/',
    'http://etlaasot-documents.railway.internal:3001/',
    'http://other.railway.internal:3000/',
    'http://etlaasot-documents.railway.internal:3000/?x=1',
  ])
    assert.equal(isAllowedDocumentsBaseUrl(url, prod()), false);
});

test('DEV/local retain their project and cannot use Production credentials', () => {
  const dev = {
    ...prod(),
    NODE_ENV: 'development',
    BRANCH_NAME: 'dev',
    RAILWAY_ENVIRONMENT_ID: '6b2b0ac3-9131-454c-9a42-4df26937f521',
    RAILWAY_ENVIRONMENT_NAME: 'dev',
    RAILWAY_SERVICE_ID: '019690d4-5b69-4bff-b685-69c84053f85e',
    SUPABASE_URL: 'https://vlysppqfozfiwcmsyban.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: key('vlysppqfozfiwcmsyban'),
    DB_HOST: 'aws-0-eu-central-1.pooler.supabase.com',
    DB_USER: 'etlaasot_app.vlysppqfozfiwcmsyban',
  };
  assert.equal(hasExpectedRegistrationConfiguration(dev), true);
  assert.equal(
    hasExpectedRegistrationConfiguration({
      ...dev,
      SUPABASE_SERVICE_ROLE_KEY: prod().SUPABASE_SERVICE_ROLE_KEY,
    }),
    false,
  );
  const local = {
    ...dev,
    RAILWAY_PROJECT_ID: undefined,
    RAILWAY_ENVIRONMENT_ID: undefined,
    RAILWAY_SERVICE_ID: undefined,
  };
  assert.equal(hasExpectedRegistrationConfiguration(local), true);
  assert.equal(
    isAllowedDocumentsBaseUrl('http://127.0.0.1:3000/', local),
    true,
  );
  assert.equal(isAllowedDocumentsBaseUrl('http://127.0.0.1:3000/', dev), false);
});
