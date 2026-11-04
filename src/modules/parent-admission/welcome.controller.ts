import {
  Body,
  Controller,
  ForbiddenException,
  Header,
  Post,
  Req,
  NotFoundException,
} from '@nestjs/common';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { AdmissionRateLimiter } from './admission.security';
import { WelcomeEmailService } from './welcome.service';
import { welcomeConfig } from './welcome.security';

export class PasswordSetupDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) token: string;
  @IsString() @MinLength(6) @MaxLength(128) password: string;
  @IsString() @MinLength(6) @MaxLength(128) confirmation: string;
}
@Controller('onboarding')
export class WelcomeController {
  constructor(
    private readonly welcome: WelcomeEmailService,
    private readonly limits: AdmissionRateLimiter,
  ) {}
  @Post('password-setup')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  async setup(@Req() req: Request, @Body() input: PasswordSetupDto) {
    if (!this.welcome.enabled()) throw new NotFoundException();
    if (req.get('origin') !== welcomeConfig().origin)
      throw new ForbiddenException('Origin not allowed');
    await this.limits.consume(
      'password-setup',
      req.socket.remoteAddress ?? 'unknown',
      input.token,
    );
    return this.welcome.consume(
      input.token,
      input.password,
      input.confirmation,
    );
  }
}
