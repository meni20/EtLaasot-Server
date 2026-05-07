import AuthService from './auth.service';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export default class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() body: { userId?: string; identifyId?: string }) {
    const userId = body.userId ?? body.identifyId;

    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    return this.authService.login(userId);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@Req() req: any) {
    return this.authService.getMe(req.user.userId);
  }
}
