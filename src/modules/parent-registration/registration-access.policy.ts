import { ForbiddenException, Injectable } from '@nestjs/common';
import { getBooleanEnv } from '../../config/env.util';

// Deliberately NOT registered as APP_GUARD or in JwtAuthGuard. Login behavior and
// existing routes stay unchanged. A future integration must explicitly call this
// after authentication; the positive essential-flow marker is server-owned.
@Injectable()
export class RegistrationAccessPolicy {
  assertAccess(input: {
    trainee: boolean;
    required: boolean;
    essentialFlow: boolean;
  }) {
    if (!getBooleanEnv('PARENT_REGISTRATION_BLOCKING_ENABLED', false)) return;
    if (input.trainee && input.required && !input.essentialFlow)
      throw new ForbiddenException({
        code: 'PARENT_REGISTRATION_REQUIRED',
        message: 'Complete parent registration before using this feature',
      });
  }
}
