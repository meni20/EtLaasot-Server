import { RegistrationIntegrationModule } from './registration-integration.module';
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { AuthorizationModule } from '../auth/authorization.module';
import { REGISTRATION_MODELS } from './entities/registration.entities';
import {
  ActivityYearController,
  RegistrationController,
} from './registration.controller';
import {
  IntegratedRegistrationDocumentGenerator,
  RegistrationDocumentGenerator,
} from './registration-document.generator';
import {
  RegistrationErrorInterceptor,
  RegistrationFeatureGuard,
} from './registration.guard';
import { RegistrationAccessPolicy } from './registration-access.policy';
import { RegistrationRepository } from './registration.repository';
import { RegistrationService } from './registration.service';
import { getBooleanEnv } from '../../config/env.util';

@Module({
  imports: [
    RegistrationIntegrationModule,
    AuthorizationModule,
    SequelizeModule.forFeature(REGISTRATION_MODELS),
  ],
  controllers: [ActivityYearController, RegistrationController],
  providers: [
    RegistrationRepository,
    RegistrationService,
    RegistrationFeatureGuard,
    RegistrationErrorInterceptor,
    RegistrationAccessPolicy,
    {
      provide: RegistrationDocumentGenerator,
      useClass: IntegratedRegistrationDocumentGenerator,
    },
  ],
  exports: [RegistrationAccessPolicy],
})
export class ParentRegistrationModule {}

export function registrationFeatureModules() {
  if (
    getBooleanEnv('PARENT_REGISTRATION_BLOCKING_ENABLED', false) &&
    !getBooleanEnv('PARENT_REGISTRATION_ENABLED', false)
  ) {
    throw new Error(
      'Registration blocking requires PARENT_REGISTRATION_ENABLED=true',
    );
  }
  if (!getBooleanEnv('PARENT_REGISTRATION_ENABLED', false)) return [];
  if (getBooleanEnv('DB_SYNC', false) || getBooleanEnv('DB_LOGGING', false)) {
    throw new Error(
      'Parent registration requires DB_SYNC=false and DB_LOGGING=false',
    );
  }
  return [ParentRegistrationModule];
}
