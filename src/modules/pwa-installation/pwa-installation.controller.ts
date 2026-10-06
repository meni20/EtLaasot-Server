import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RegisterPwaInstallationDto } from './dtos/register-pwa-installation.dto';
import { PwaInstallationService } from './pwa-installation.service';

@Controller('pwa-installations')
@UseGuards(JwtAuthGuard)
export class PwaInstallationController {
  constructor(private readonly service: PwaInstallationService) {}

  @Post('register')
  register(
    @Req() request: { user: { userId: string } },
    @Body() body: RegisterPwaInstallationDto,
  ) {
    return this.service.register(request.user.userId, body);
  }
}
