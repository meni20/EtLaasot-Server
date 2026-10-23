import { Global, Module } from '@nestjs/common';
import { AuthorizationService } from './authorization.service';
import { RolesGuard } from './guards/roles.guard';
import { RegistrationRequestAccess } from '../parent-registration/registration-request-access';

@Global()
@Module({
  providers: [AuthorizationService, RolesGuard, RegistrationRequestAccess],
  exports: [AuthorizationService, RolesGuard, RegistrationRequestAccess],
})
export class AuthorizationModule {}
