import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { RegistrationIntegrationService } from './registration-integration.service';
import { ADMISSION_MODELS } from '../parent-admission/admission.entities';
import { REGISTRATION_MODELS } from './entities/registration.entities';
@Module({
  imports: [
    SequelizeModule.forFeature([...ADMISSION_MODELS, ...REGISTRATION_MODELS]),
  ],
  providers: [RegistrationIntegrationService],
  exports: [RegistrationIntegrationService],
})
export class RegistrationIntegrationModule {}
