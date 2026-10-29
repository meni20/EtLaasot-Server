import type { VolunteerPurpose } from './volunteer.contract';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  SetMetadata,
  UseGuards,
  UseInterceptors,
  ForbiddenException,
  HttpException,
  UploadedFile,
  ParseIntPipe,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomInt } from 'crypto';
import {
  getBooleanEnv,
  getOptionalEnv,
  useSecureCookies,
} from '../../config/env.util';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { RegistrationRequest } from '../parent-registration/registration.guard';
import { RegistrationErrorInterceptor } from '../parent-registration/registration.guard';
import { AdmissionService } from './admission.service';
import {
  AdmissionRateLimiter,
  normalizeRecoveryCode,
  RECOVERY_CODE_PATTERN,
} from './admission.security';
import { getNationalIdDetails } from '../user/national-id.util';
import {
  ApplicationApprovalDto,
  ApplicationDraftDto,
  ApplicationListDto,
  ApplicationReviewDto,
  IdentifyDto,
  RecoverApplicationDto,
  ReissueRecoveryCodeDto,
  StartApplicationDto,
  SubmitApplicationDto,
} from './admission.dto';

const ENABLE_FLAG = 'parent-admission:flag';
export const ApplicantFeature = () =>
  SetMetadata(ENABLE_FLAG, 'APPLICANT_REGISTRATION_ENABLED');
@Injectable()
export class AdmissionFeatureGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    ctx
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Cache-Control', 'private, no-store');
    const flag =
      Reflect.getMetadata(ENABLE_FLAG, ctx.getHandler()) ??
      Reflect.getMetadata(ENABLE_FLAG, ctx.getClass());
    if (!flag || !getBooleanEnv(flag, false)) throw new NotFoundException();
    return true;
  }
}
@Injectable()
export class AdmissionPublicGuard implements CanActivate {
  constructor(private readonly limits: AdmissionRateLimiter) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<Request>();
    ctx
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Referrer-Policy', 'no-referrer');
    const origins = getOptionalEnv('CORS_ORIGINS')
      ?.split(',')
      .map((x) => x.trim()) ?? [
      'http://127.0.0.1:5173',
      'http://localhost:5173',
    ];
    if (req.headers.origin && !origins.includes(req.headers.origin))
      throw new ForbiddenException('Trusted origin required');
    if (
      req.method !== 'GET' &&
      !req.headers.origin &&
      !req.headers['x-applicant-session']
    )
      throw new ForbiddenException('Trusted origin required');
    if (Buffer.byteLength(JSON.stringify(req.body ?? {}), 'utf8') > 96 * 1024)
      throw new HttpException('Registration request is too large', 413);
    const action =
      req.path === '/auth/identify'
        ? 'identify'
        : req.path.endsWith('/start')
          ? 'start'
          : req.path.endsWith('/recover')
            ? 'recover'
            : req.path.endsWith('/branches')
              ? 'branches'
              : 'session';
    // IDs/tokens are never used as map keys, URLs or plaintext persistent counters.
    let identity: string | undefined;
    if (action === 'identify' || action === 'start') {
      try {
        identity = getNationalIdDetails(
          String(req.body?.identifier ?? ''),
        ).nationalIdHash;
      } catch {
        /* Invalid input still consumes the IP/global budget. */
      }
    }
    if (action === 'recover' && typeof req.body?.recoveryCode === 'string') {
      const code = normalizeRecoveryCode(req.body.recoveryCode);
      if (RECOVERY_CODE_PATTERN.test(code)) identity = code;
    }
    await this.limits.consume(
      action,
      req.socket.remoteAddress ?? 'unknown',
      identity,
    );
    return true;
  }
}
function applicantCredential(req: Request): string {
  const header = req.headers['x-applicant-session'];
  if (typeof header === 'string') return header;
  const value = req.headers.cookie
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith('parent_applicant='));
  return value?.slice('parent_applicant='.length) ?? '';
}
const cookieOptions = () => ({
  httpOnly: true,
  secure: useSecureCookies(),
  sameSite: (useSecureCookies() ? 'none' : 'lax') as 'none' | 'lax',
  path: '/parent-applications',
  maxAge: 24 * 60 * 60 * 1000,
});

@Controller('auth')
@UseGuards(AdmissionFeatureGuard, AdmissionPublicGuard)
@UseInterceptors(RegistrationErrorInterceptor)
export class LoginInitiationController {
  constructor(private readonly service: AdmissionService) {}
  @Post('identify')
  @SetMetadata(ENABLE_FLAG, 'ID_FIRST_LOGIN_ENABLED')
  async identify(@Body() input: IdentifyDto) {
    const started = Date.now(),
      minimum = 250 + randomInt(0, 51);
    try {
      return await this.service.identify(input.identifier);
    } finally {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, minimum - (Date.now() - started))),
      );
    }
  }
}
@Controller('parent-applications')
@ApplicantFeature()
@UseGuards(AdmissionFeatureGuard, AdmissionPublicGuard)
@UseInterceptors(RegistrationErrorInterceptor)
export class ApplicantController {
  constructor(private readonly service: AdmissionService) {}
  @Get('branches') branches() {
    return this.service.branches();
  }
  @Post('start') async start(
    @Body() input: StartApplicationDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.service.start(
      input.identifier,
      input.branchId,
      input.registrationType,
    );
    res.cookie('parent_applicant', result.token, cookieOptions());
    const { token, ...body } = result;
    return { ...body, sessionToken: token };
  }
  @Post('recover') async recover(
    @Body() input: RecoverApplicationDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.service.recover(input.recoveryCode);
    res.cookie('parent_applicant', result.token, cookieOptions());
    const { token, ...body } = result;
    return { ...body, sessionToken: token };
  }
  @Get('me') me(@Req() req: Request) {
    return this.service.me(applicantCredential(req));
  }
  @Patch('me/draft') save(
    @Req() req: Request,
    @Body() input: ApplicationDraftDto,
  ) {
    return this.service.save(applicantCredential(req), input);
  }
  @Post('me/submit') submit(
    @Req() req: Request,
    @Body() input: SubmitApplicationDto,
  ) {
    return this.service.submit(applicantCredential(req), input);
  }
  @Post('session/revoke') async revoke(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.service.revoke(applicantCredential(req));
    res.clearCookie('parent_applicant', cookieOptions());
    return result;
  }
  @Get('me/attachment-capabilities') async capabilities(@Req() req: Request) {
    const snapshot = await this.service.me(applicantCredential(req));
    const integration =
      snapshot.integration === 'READY' ? 'READY' : 'UNAVAILABLE';
    return {
      uploads: integration,
      pdf: integration,
      submission: integration === 'READY',
      approval: integration === 'READY',
    };
  }
  @Post('me/attachments') async unsupportedReference(@Req() req: Request) {
    await this.service.me(applicantCredential(req));
    throw new HttpException(
      'Use a verified multipart upload; storage references are never accepted',
      503,
    );
  }
  @Post('me/attachments/:kind')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 3 },
    }),
  )
  attachments(
    @Req() req: Request,
    @Param('kind') kind: string,
    @Body('revision', ParseIntPipe) revision: number,
    @Body('signer')
    signer: 'parent1' | 'parent2' | VolunteerPurpose | undefined,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.upload(
      applicantCredential(req),
      revision,
      kind,
      file?.buffer,
      signer,
    );
  }
  @Get('me/pdf') async pdf(@Req() req: Request, @Res() res: Response) {
    const result = await this.service.applicantPdf(applicantCredential(req));
    res
      .set({
        'Content-Type': 'application/pdf',
        'Content-Disposition':
          'attachment; filename="volunteer-registration.pdf"',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(result.bytes);
  }
  @Post('me/pdf/retry') retry(@Req() req: Request) {
    return this.service.retry(applicantCredential(req));
  }
}
@Controller('parent-applications/admin')
@ApplicantFeature()
@UseGuards(JwtAuthGuard, AdmissionFeatureGuard)
@UseInterceptors(RegistrationErrorInterceptor)
export class ApplicantAdminController {
  constructor(
    private readonly service: AdmissionService,
    private readonly limits: AdmissionRateLimiter,
  ) {}
  @Post(':id/recovery-code/reissue') async reissueRecoveryCode(
    @Req() req: RegistrationRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: ReissueRecoveryCodeDto,
  ) {
    await this.limits.consume(
      'reissue',
      String(req.user.userId ?? req.user.sub ?? 'unknown'),
      id,
    );
    return this.service.reissueRecoveryCode(
      req.user,
      id,
      input.identityVerified,
    );
  }
  @Get() list(
    @Req() req: RegistrationRequest,
    @Query() input: ApplicationListDto,
  ) {
    return this.service.list(
      req.user,
      input.branchId,
      input.page,
      input.registrationType,
      input.status,
      input.search,
    );
  }
  @Get(':id') detail(
    @Req() req: RegistrationRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.detail(req.user, id);
  }
  @Post(':id/pdf/retry') retry(
    @Req() req: RegistrationRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.adminRetry(req.user, id);
  }
  @Get(':id/documents/:documentId') async document(
    @Req() req: RegistrationRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('documentId', new ParseUUIDPipe({ version: '4' }))
    documentId: string,
    @Res() res: Response,
  ) {
    const result = await this.service.document(req.user, id, documentId);
    res
      .set({
        'Content-Type': result.mimeType,
        'Content-Disposition':
          'attachment; filename="registration-evidence.' +
          (result.mimeType === 'application/pdf'
            ? 'pdf'
            : result.mimeType === 'image/jpeg'
              ? 'jpg'
              : 'png') +
          '"',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(result.bytes);
  }
  @Post(':id/request-changes') changes(
    @Req() req: RegistrationRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: ApplicationReviewDto,
  ) {
    return this.service.review(
      req.user,
      id,
      'CHANGES_REQUESTED',
      input.reason,
      input.expectedVersionId,
    );
  }
  @Post(':id/reject') reject(
    @Req() req: RegistrationRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: ApplicationReviewDto,
  ) {
    return this.service.review(
      req.user,
      id,
      'REJECTED',
      input.reason,
      input.expectedVersionId,
    );
  }
  @Post(':id/approve') approve(
    @Req() req: RegistrationRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: ApplicationApprovalDto,
  ) {
    return this.service.approve(
      req.user,
      id,
      input.expectedVersionId,
      input.identityVerified,
    );
  }
}
