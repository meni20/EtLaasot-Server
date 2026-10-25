import {
  CallHandler,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
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
  private readonly logger = new Logger(RegistrationErrorInterceptor.name);

  intercept(_context: ExecutionContext, next: CallHandler) {
    return next
      .handle()
      .pipe(
        catchError((error) => {
          if (!(error instanceof HttpException)) {
            const candidate = error as {
              name?: unknown;
              code?: unknown;
              parent?: { code?: unknown };
              cause?: { code?: unknown };
            };
            const name =
              typeof candidate?.name === 'string'
                ? candidate.name.replace(/[^A-Za-z]/g, '').slice(0, 40)
                : 'UnknownError';
            const rawCode =
              candidate?.code ?? candidate?.parent?.code ?? candidate?.cause?.code;
            const code =
              typeof rawCode === 'string' && /^[A-Z0-9_]{2,20}$/.test(rawCode)
                ? `:${rawCode}`
                : '';
            this.logger.warn(`Unexpected registration failure: ${name}${code}`);
          }
          return throwError(() =>
            error instanceof HttpException
              ? error
              : new ServiceUnavailableException(
                  'Registration operation failed; retry safely',
                ),
          );
        }),
      );
  }
}
