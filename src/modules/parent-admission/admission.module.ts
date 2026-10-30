import { RegistrationIntegrationModule } from '../parent-registration/registration-integration.module';
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { getBooleanEnv } from '../../config/env.util';
import { UserModule } from '../user/user.module';
import { AuthorizationModule } from '../auth/authorization.module';
import { RegistrationErrorInterceptor } from '../parent-registration/registration.guard';
import { ADMISSION_MODELS } from './admission.entities';
import { AdmissionRepository } from './admission.repository';
import { AdmissionService } from './admission.service';
import { AdmissionRateLimiter, admissionHash } from './admission.security';
import {
  AdmissionEvidenceGateway,
  IntegratedAdmissionEvidence,
} from './admission.evidence';
import {
  AdmissionFeatureGuard,
  AdmissionPublicGuard,
  ApplicantAdminController,
  ApplicantController,
  LoginInitiationController,
} from './admission.controller';

@Module({
  imports: [
    RegistrationIntegrationModule,
    UserModule,
    AuthorizationModule,
    SequelizeModule.forFeature(ADMISSION_MODELS),
  ],
  controllers: [
    LoginInitiationController,
    ApplicantController,
    ApplicantAdminController,
  ],
  providers: [
    AdmissionService,
    AdmissionRepository,
    AdmissionRateLimiter,
    AdmissionFeatureGuard,
    AdmissionPublicGuard,
    RegistrationErrorInterceptor,
    {
      provide: AdmissionEvidenceGateway,
      useClass: IntegratedAdmissionEvidence,
    },
  ],
})
export class ParentAdmissionModule {}
export function admissionFeatureModules() {
  if (
    !getBooleanEnv('ID_FIRST_LOGIN_ENABLED', false) &&
    !getBooleanEnv('APPLICANT_REGISTRATION_ENABLED', false)
  )
    return [];
  if (!getBooleanEnv('PARENT_ADMISSION_SCHEMA_READY', false))
    throw new Error(
      'Phase 4 requires approved migration 031 and PARENT_ADMISSION_SCHEMA_READY=true',
    );
  if (getBooleanEnv('DB_SYNC', false) || getBooleanEnv('DB_LOGGING', false))
    throw new Error('Phase 4 requires DB_SYNC=false and DB_LOGGING=false');
  admissionHash('configuration', 'check'); // Require dedicated pepper; do not change existing identity keys.
  return [ParentAdmissionModule];
}
