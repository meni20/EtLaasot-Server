import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import MentorAssignment from './entities/mentor-assignment.entity';
import MentorAssignmentService from './mentor-assignment.service';
import MentorAssignmentRepository from './mentor-assignment.repository';
import MentorAssignmentController from './mentor-assignment.controller';
import { UserModule } from '../user/user.module';

@Module({
  imports: [SequelizeModule.forFeature([MentorAssignment]), UserModule],
  controllers: [MentorAssignmentController],
  providers: [MentorAssignmentService, MentorAssignmentRepository],
  exports: [MentorAssignmentService],
})
export class MentorAssignmentModule {}
