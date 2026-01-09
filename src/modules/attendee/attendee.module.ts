import { Module } from '@nestjs/common';
import AttendeeService from './attendee.service';
import Attendee from './entities/attendee.entity';
import { SequelizeModule } from '@nestjs/sequelize';
import AttendeeRepository from './attendee.repository';

@Module({
  imports: [SequelizeModule.forFeature([Attendee])],
  providers: [AttendeeService, AttendeeRepository],
  exports: [AttendeeService],
})
export class AttendeeModule {}
