import AuthService from './auth.service';
import {
  Body,
  Controller,
  Get,
  Header,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { Response } from 'express';
import { useSecureCookies } from 'src/config/env.util';
import { AllowPasswordChangeRequired } from './decorators/allow-password-change-required.decorator';

class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  identifier: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  recaptchaToken?: string;
}

class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  currentPassword: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  newPassword: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  confirmPassword: string;
}

@Controller('auth')
export default class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(
      body.identifier,
      body.password,
      body.recaptchaToken,
    );

    const crossSite = useSecureCookies();

    res.cookie('access_token', result.token, {
      httpOnly: true,
      sameSite: crossSite ? 'none' : 'lax',
      secure: crossSite,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    return {
      token: result.token,
      roles: result.roles,
      activeBranch: result.activeBranch,
      mustChangePassword: result.mustChangePassword,
    };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    const crossSite = useSecureCookies();

    res.clearCookie('access_token', {
      httpOnly: true,
      sameSite: crossSite ? 'none' : 'lax',
      secure: crossSite,
      path: '/',
    });

    return { ok: true };
  }

  @Get('me')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(JwtAuthGuard)
  @AllowPasswordChangeRequired()
  getMe(@Req() req: any) {
    const { sub: _sub, ...user } = req.user;
    return user;
  }

  @Patch('change-password')
  @UseGuards(JwtAuthGuard)
  @AllowPasswordChangeRequired()
  changePassword(@Body() body: ChangePasswordDto, @Req() req: any) {
    return this.authService.changePassword(
      req.user.userId,
      body.currentPassword,
      body.newPassword,
      body.confirmPassword,
    );
  }
}
