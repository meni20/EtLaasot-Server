import AuthService from './auth.service';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { Response } from 'express';
import { isProduction } from 'src/config/env.util';

class LoginDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{5,9}$/)
  userId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{5,9}$/)
  identifyId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  loginCode: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  recaptchaToken?: string;
}

@Controller('auth')
export default class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response) {
    const userId = body.userId ?? body.identifyId;

    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    const result = await this.authService.login(
      userId,
      body.loginCode,
      body.recaptchaToken,
    );

    res.cookie('access_token', result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction(),
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    return {
      roles: result.roles,
      activeBranch: result.activeBranch,
    };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('access_token', {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction(),
      path: '/',
    });

    return { ok: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@Req() req: any) {
    return this.authService.getMe(req.user.userId);
  }
}
