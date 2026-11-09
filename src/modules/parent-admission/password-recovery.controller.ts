import {
  Body,
  Controller,
  Header,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { RegistrationRequest } from '../parent-registration/registration.guard';
import { RegistrationErrorInterceptor } from '../parent-registration/registration.guard';
import { ApplicantPasswordGuard } from './application-credentials.controller';
import { assertApplicantPasswordFeature } from './application-credentials.feature';
import { AdmissionRateLimiter } from './admission.security';
import { PasswordRecoveryService } from './password-recovery.service';
class ResetRequestDto {
  @IsString() @Matches(/^\d{5,9}$/) identifier: string;
}
class ResetConsumeDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) token: string;
  @Transform(({ obj, key }) => obj[key])
  @IsString()
  @Length(6, 128)
  password: string;
  @Transform(({ obj, key }) => obj[key])
  @IsString()
  @Length(6, 128)
  confirmation: string;
}
class AuthorizeRecoveryDto {
  @IsIn(['USER', 'APPLICATION', 'IDENTITY']) subjectType:
    | 'USER'
    | 'APPLICATION'
    | 'IDENTITY';
  @IsString() @Length(5,36) subjectId: string;
  @IsString() @MaxLength(254) email: string;
  @Transform(({ obj, key }) => obj[key]) @IsBoolean() identityVerified: boolean;
  @Transform(({ obj, key }) => obj[key]) @IsBoolean() emailConfirmed: boolean;
}
@Controller('password-recovery')
@UseInterceptors(RegistrationErrorInterceptor)
export class PasswordRecoveryController {
  constructor(
    private readonly service: PasswordRecoveryService,
    private readonly limits: AdmissionRateLimiter,
  ) {}
  @Post('request')
  @UseGuards(ApplicantPasswordGuard)
  request(@Body() input: ResetRequestDto) {
    return this.service.request(input.identifier);
  }
  @Post('consume')
  @UseGuards(ApplicantPasswordGuard)
  consume(@Body() input: ResetConsumeDto) {
    return this.service.consume(
      input.token,
      input.password,
      input.confirmation,
    );
  }
  @Post('authorize')
  @UseGuards(JwtAuthGuard)
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  async authorize(
    @Req() req: RegistrationRequest & Request,
    @Body() input: AuthorizeRecoveryDto,
  ) {
    assertApplicantPasswordFeature();
    await this.limits.consume(
      'reset-authorize',
      req.socket.remoteAddress ?? 'unknown',
      input.subjectId,
    );
    return this.service.authorize(req.user, input);
  }
}
