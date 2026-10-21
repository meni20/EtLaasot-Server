import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { AuthorizationModule } from '../auth/authorization.module';
import { REGISTRATION_MODELS } from './entities/registration.entities';
import {
  ActivityYearController,
  RegistrationController,
} from './registration.controller';
import {
  DeferredRegistrationDocumentGenerator,
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
      useClass: DeferredRegistrationDocumentGenerator,
    },
  ],
  exports: [RegistrationAccessPolicy],
})
export class ParentRegistrationModule {}

export function registrationFeatureModules() {
  if (!getBooleanEnv('PARENT_REGISTRATION_ENABLED', false)) return [];
  if (getBooleanEnv('DB_SYNC', false) || getBooleanEnv('DB_LOGGING', false)) {
    throw new Error(
      'Parent registration requires DB_SYNC=false and DB_LOGGING=false',
    );
  }
  return [ParentRegistrationModule];
}
