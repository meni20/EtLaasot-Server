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

@Controller('mentor-assignment')
@UseGuards(JwtAuthGuard)
export default class MentorAssignmentController {
  constructor(
    private readonly mentorAssignmentService: MentorAssignmentService,
  ) {}

  @Get('my-trainees')
  getMyTrainees(@Req() req: Request & { user: { userId: string } }) {
    return this.mentorAssignmentService.getMyTrainees(req.user.userId);
  }

  @Get(':branchId')
  getAssignments(@Param('branchId') branchId: string) {
    return this.mentorAssignmentService.getAssignmentsByBranch(branchId);
  }

  @Get(':branchId/unassigned')
  getUnassignedTrainees(@Param('branchId') branchId: string) {
    return this.mentorAssignmentService.getUnassignedTrainees(branchId);
  }

  @Post('assign')
  assignTrainee(@Body() dto: CreateMentorAssignmentDto) {
    return this.mentorAssignmentService.assignTrainee(
      dto.mentorId,
      dto.traineeId,
      dto.branchId,
    );
  }

  @Delete(':assignmentId')
  removeAssignment(@Param('assignmentId') id: string) {
    return this.mentorAssignmentService.removeAssignment(id);
  }

  @Put(':assignmentId/transfer')
  transferTrainee(
    @Param('assignmentId') id: string,
    @Body() dto: TransferTraineeDto,
  ) {
    return this.mentorAssignmentService.transferTrainee(id, dto.newMentorId);
  }
}
