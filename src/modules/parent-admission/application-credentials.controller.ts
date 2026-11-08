import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  Injectable,
  Post,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { getOptionalEnv, useSecureCookies } from '../../config/env.util';
import { getNationalIdDetails } from '../user/national-id.util';
import { RegistrationErrorInterceptor } from '../parent-registration/registration.guard';
import { AdmissionRateLimiter } from './admission.security';
import {
  ApplicantPasswordLoginDto,
  ApplicantPasswordSignupDto,
} from './application-credentials.dto';
import { assertApplicantPasswordFeature } from './application-credentials.feature';
import { ApplicationCredentialsService } from './application-credentials.service';

@Injectable()
export class ApplicantPasswordGuard implements CanActivate {
  constructor(private readonly limits: AdmissionRateLimiter) {}
  async canActivate(ctx: ExecutionContext) {
    const response = ctx.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    assertApplicantPasswordFeature();
    const req = ctx.switchToHttp().getRequest<Request>();
    const origins =
      getOptionalEnv('CORS_ORIGINS')
        ?.split(',')
        .map((x) => x.trim()) ?? [];
    // A supplied applicant header never bypasses Origin checks on public auth.
    if (!req.headers.origin || !origins.includes(req.headers.origin))
      throw new ForbiddenException('Trusted origin required');
    if (Buffer.byteLength(JSON.stringify(req.body ?? {})) > 4096)
      throw new HttpException('Request too large', 413);
    let identity: string | undefined;
    try {
      identity = getNationalIdDetails(
        String(req.body?.identifier ?? ''),
      ).nationalIdHash;
    } catch {
      /* Invalid inputs still consume the peer/global rate budget. */
    }
    await this.limits.consume(
      req.path.endsWith('/signup')
        ? 'applicant-password-signup'
        : 'applicant-password-login',
      req.socket.remoteAddress ?? 'unknown',
      identity,
    );
    return true;
  }
}

@Controller('parent-applications/password')
@UseGuards(ApplicantPasswordGuard)
@UseInterceptors(RegistrationErrorInterceptor)
export class ApplicationCredentialsController {
  constructor(private readonly service: ApplicationCredentialsService) {}
  private respond(
    result: { token: string; expiresAt: Date },
    response: Response,
  ) {
    const secure = useSecureCookies();
    response.cookie('parent_applicant', result.token, {
      httpOnly: true,
      secure,
      sameSite: secure ? 'none' : 'lax',
      path: '/parent-applications',
      maxAge: 24 * 60 * 60 * 1000,
    });
    // Applicant token only; never a regular JWT, hash, email or recovery code.
    return { sessionToken: result.token, expiresAt: result.expiresAt };
  }
  @Post('signup')
  async signup(
    @Body() input: ApplicantPasswordSignupDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.respond(await this.service.signup(input), response);
  }
  @Post('login')
  async login(
    @Body() input: ApplicantPasswordLoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.respond(await this.service.login(input), response);
  }
}
