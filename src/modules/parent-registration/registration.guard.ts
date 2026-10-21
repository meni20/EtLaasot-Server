import {
  CallHandler,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  Injectable,
  NestInterceptor,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { catchError, throwError } from 'rxjs';
import {
  getBooleanEnv,
  getOptionalEnv,
  isProduction,
} from '../../config/env.util';
import type { Request } from 'express';
import type { AuthUser } from '../auth/authorization.service';

export type RegistrationRequest = Request & { user: AuthUser };
@Injectable()
export class RegistrationFeatureGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    context
      .switchToHttp()
      .getResponse()
      .setHeader('Cache-Control', 'private, no-store');
    if (!getBooleanEnv('PARENT_REGISTRATION_ENABLED', false))
      throw new NotFoundException();
    const req = context.switchToHttp().getRequest<RegistrationRequest>();
    if (
      ['POST', 'PATCH'].includes(req.method) &&
      !/^Bearer\s+\S+$/i.test(req.headers.authorization ?? '')
    ) {
      const origins =
        getOptionalEnv('CORS_ORIGINS')
          ?.split(',')
          .map((x) => x.trim()) ??
        (isProduction()
          ? []
          : ['http://localhost:5173', 'http://localhost:5174']);
      if (!req.headers.origin || !origins.includes(req.headers.origin))
        throw new ForbiddenException('Trusted origin required');
    }
    return true;
  }
}
// Sequelize errors can contain bound medical data. Convert unexpected failures to
// a safe HTTP exception before Nest's default exception logger can serialize them.
@Injectable()
export class RegistrationErrorInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler) {
    return next
      .handle()
      .pipe(
        catchError((error) =>
          throwError(() =>
            error instanceof HttpException
              ? error
              : new ServiceUnavailableException(
                  'Registration operation failed; retry safely',
                ),
          ),
        ),
      );
  }
}
