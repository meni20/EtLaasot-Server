import { Module, forwardRef } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import Branch from './entities/branch.entity';
import BranchService from './branch.service';
import BranchRepository from './branch.repository';
import BranchController from './branch.controller';
import { UserModule } from '../user/user.module';
import { EventModule } from '../event/event.module';
import { AttendeeModule } from '../attendee/attendee.module';
import { MentorAssignmentModule } from '../mentor-assignment/mentor-assignment.module';

@Module({
  imports: [
    SequelizeModule.forFeature([Branch]),
    forwardRef(() => UserModule),
    forwardRef(() => EventModule),
    forwardRef(() => AttendeeModule),
    forwardRef(() => MentorAssignmentModule),
  ],
  controllers: [BranchController],
  providers: [BranchService, BranchRepository],
  exports: [BranchService],
})
export class BranchModule {}
