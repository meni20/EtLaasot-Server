import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AUTH_ROLES } from 'src/constants/auth.constants';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  RegisterPushSubscriptionDto,
  RemovePushSubscriptionDto,
} from './dtos/push-subscription.dto';
import { PushNotificationService } from './push-notification.service';

type AuthenticatedRequest = { user: { userId: string } };

@Controller('push-notifications')
@UseGuards(JwtAuthGuard)
export class PushNotificationController {
  constructor(private readonly service: PushNotificationService) {}

  @Get('public-key')
  getPublicKey() {
    return this.service.getPublicKey();
  }

  @Put('subscription')
  register(
    @Req() request: AuthenticatedRequest,
    @Body() body: RegisterPushSubscriptionDto,
  ) {
    return this.service.register(request.user.userId, body);
  }

  @Delete('subscription')
  remove(
    @Req() request: AuthenticatedRequest,
    @Body() body: RemovePushSubscriptionDto,
  ) {
    return this.service.remove(request.user.userId, body);
  }

  @Post('test')
  @UseGuards(RolesGuard)
  @Roles(AUTH_ROLES.SUPER_ADMIN.id, AUTH_ROLES.BRANCH_ADMIN.id)
  sendSelfTest(@Req() request: AuthenticatedRequest) {
    return this.service.sendSelfTest(request.user.userId);
  }
}
