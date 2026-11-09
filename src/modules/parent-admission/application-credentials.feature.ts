import { NotFoundException } from '@nestjs/common';
import { getBooleanEnv } from '../../config/env.util';
import {
  isVerifiedRailwayDevRuntime,
  isVerifiedRailwayProductionRuntime,
  hasExpectedRegistrationConfiguration,
  isAllowedDocumentsBaseUrl,
} from '../parent-registration/registration-environment';

export function assertApplicantPasswordFeature() {
  const localDev =
    process.env.NODE_ENV === 'development' &&
    process.env.ETLAASOT_RUNTIME_TARGET === 'development' &&
    process.env.BRANCH_NAME === 'dev' &&
    !process.env.RAILWAY_PROJECT_ID &&
    !process.env.RAILWAY_ENVIRONMENT_ID &&
    !process.env.RAILWAY_SERVICE_ID;
  const production = isVerifiedRailwayProductionRuntime();
  const expected = production
    ? {
        ref: 'tmlnuqrwhdeplpeuuvwv',
        host: 'aws-1-eu-central-1.pooler.supabase.com',
      }
    : {
        ref: 'vlysppqfozfiwcmsyban',
        host: 'aws-0-eu-central-1.pooler.supabase.com',
      };
  if (
    (!localDev && !isVerifiedRailwayDevRuntime() && !production) ||
    process.env.SUPABASE_URL !== `https://${expected.ref}.supabase.co` ||
    process.env.DB_USER !== `etlaasot_app.${expected.ref}` ||
    process.env.DB_HOST !== expected.host ||
    (production &&
      (!hasExpectedRegistrationConfiguration() ||
        !isAllowedDocumentsBaseUrl(
          process.env.REGISTRATION_DOCUMENTS_URL ?? '',
        ) ||
        process.env.PUBLIC_CLIENT_ORIGIN !==
          'https://etlaasot-client-main-main.up.railway.app')) ||
    process.env.DB_PORT !== '5432' ||
    process.env.DB_NAME !== 'postgres' ||
    process.env.DB_SSL !== 'true' ||
    !getBooleanEnv('DB_SSL_REJECT_UNAUTHORIZED', true) ||
    !getBooleanEnv('APPLICANT_PASSWORD_AUTH_ENABLED', false) ||
    !getBooleanEnv('APPLICANT_REGISTRATION_ENABLED', false) ||
    !getBooleanEnv('PARENT_ADMISSION_SCHEMA_READY', false) ||
    !getBooleanEnv('APPLICATION_CREDENTIALS_SCHEMA_READY', false) ||
    getBooleanEnv('DB_SYNC', false) ||
    getBooleanEnv('DB_LOGGING', false)
  )
    throw new NotFoundException();
}
