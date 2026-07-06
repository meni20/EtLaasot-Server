import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ALLOW_PASSWORD_CHANGE_REQUIRED } from '../decorators/allow-password-change-required.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext) {
    const canActivate = await super.canActivate(context);
    const request = context.switchToHttp().getRequest();

    if (
      request?.user?.mustChangePassword &&
      !this.allowsPasswordChangeRequired(context)
    ) {
      throw new ForbiddenException('password change required');
    }

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
