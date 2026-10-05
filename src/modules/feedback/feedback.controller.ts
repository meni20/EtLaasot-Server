import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AUTH_ROLES } from 'src/constants/auth.constants';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { FeatureRequestDto } from './dtos/feature-request.dto';
import { FeedbackService, type FeedbackActor } from './feedback.service';

@Controller('feedback')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(AUTH_ROLES.SUPER_ADMIN.id, AUTH_ROLES.BRANCH_ADMIN.id)
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post('feature-request')
  submitFeatureRequest(
    @Req() request: { user: FeedbackActor },
    @Body() body: FeatureRequestDto,
  ) {
    return this.feedbackService.submitFeatureRequest(request.user, body);
  }
}
