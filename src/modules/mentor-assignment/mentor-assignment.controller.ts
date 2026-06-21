import {
  Controller,
  Get,
  Post,
  Delete,
  Put,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import MentorAssignmentService from './mentor-assignment.service';
import {
  CreateMentorAssignmentDto,
  TransferTraineeDto,
} from './dtos/mentor-assignment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthorizationService } from '../auth/authorization.service';
import { AUTH_ROLES } from 'src/constants/auth.constants';

@Controller('mentor-assignment')
@UseGuards(JwtAuthGuard)
export default class MentorAssignmentController {
  constructor(
    private readonly mentorAssignmentService: MentorAssignmentService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  @Get('my-trainees')
  getMyTrainees(@Req() req: Request & { user: { userId: string } }) {
    return this.mentorAssignmentService.getMyTrainees(req.user.userId);
  }

  @Get(':branchId')
  getAssignments(@Param('branchId') branchId: string, @Req() req: any) {
    this.authorizationService.assertAdminForBranch(req.user, branchId);
    return this.mentorAssignmentService.getAssignmentsByBranch(branchId);
  }

  @Get(':branchId/unassigned')
  getUnassignedTrainees(@Param('branchId') branchId: string, @Req() req: any) {
    this.authorizationService.assertAdminForBranch(req.user, branchId);
    return this.mentorAssignmentService.getUnassignedTrainees(branchId);
  }

  @Post('assign')
  async assignTrainee(@Body() dto: CreateMentorAssignmentDto, @Req() req: any) {
    this.authorizationService.assertAdminForBranch(req.user, dto.branchId);
    await Promise.all([
      this.authorizationService.assertUserBelongsToBranch(
        dto.mentorId,
        dto.branchId,
      ),
      this.authorizationService.assertUserBelongsToBranch(
        dto.traineeId,
        dto.branchId,
      ),
      this.authorizationService.assertUserHasRole(
        dto.mentorId,
        AUTH_ROLES.VOLUNTEER.id,
      ),
      this.authorizationService.assertUserHasRole(
        dto.traineeId,
        AUTH_ROLES.TRAINEE.id,
      ),
    ]);

    return this.mentorAssignmentService.assignTrainee(
      dto.mentorId,
      dto.traineeId,
      dto.branchId,
    );
  }

  @Delete(':assignmentId')
  async removeAssignment(@Param('assignmentId') id: string, @Req() req: any) {
    await this.authorizationService.assertAdminForAssignment(req.user, id);
    return this.mentorAssignmentService.removeAssignment(id);
  }

  @Put(':assignmentId/transfer')
  async transferTrainee(
    @Param('assignmentId') id: string,
    @Body() dto: TransferTraineeDto,
    @Req() req: any,
  ) {
    const branchId = await this.authorizationService.assertAdminForAssignment(
      req.user,
      id,
    );
    await Promise.all([
      this.authorizationService.assertUserBelongsToBranch(
        dto.newMentorId,
        branchId,
      ),
      this.authorizationService.assertUserHasRole(
        dto.newMentorId,
        AUTH_ROLES.VOLUNTEER.id,
      ),
    ]);

    return this.mentorAssignmentService.transferTrainee(id, dto.newMentorId);
  }
}
