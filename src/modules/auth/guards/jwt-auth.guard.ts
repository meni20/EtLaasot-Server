import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ALLOW_PASSWORD_CHANGE_REQUIRED } from '../decorators/allow-password-change-required.decorator';
import { RegistrationRequestAccess } from '../../parent-registration/registration-request-access';
import { getBooleanEnv } from '../../../config/env.util';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(@Optional() private readonly registrationAccess?: RegistrationRequestAccess) { super(); }
  async canActivate(context: ExecutionContext) {
    const canActivate = await super.canActivate(context);
    const request = context.switchToHttp().getRequest();

    if (
      request?.user?.mustChangePassword &&
      !this.allowsPasswordChangeRequired(context)
    ) {
      throw new ForbiddenException('password change required');
    }

    if (getBooleanEnv('PARENT_REGISTRATION_BLOCKING_ENABLED', false) && !this.registrationAccess) {
      throw new ServiceUnavailableException('Registration access verification is unavailable');
    }
    await this.registrationAccess?.assertRequest(context);
    return canActivate as boolean;
  }

  private allowsPasswordChangeRequired(context: ExecutionContext) {
    return Boolean(
      Reflect.getMetadata(
        ALLOW_PASSWORD_CHANGE_REQUIRED,
        context.getHandler(),
      ) ||
        Reflect.getMetadata(
          ALLOW_PASSWORD_CHANGE_REQUIRED,
          context.getClass(),
        ),
    );
  }
}
