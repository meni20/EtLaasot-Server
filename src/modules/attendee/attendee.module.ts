import { Module, forwardRef } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import AttendeeService from './attendee.service';
import AttendeeRepository from './attendee.repository';
import Attendee from './entities/attendee.entity';
import { EventModule } from '../event/event.module';

@Module({
  imports: [
    SequelizeModule.forFeature([Attendee]),
    forwardRef(() => EventModule),
  ],
  providers: [AttendeeService, AttendeeRepository],
  exports: [AttendeeService],
})
export class AttendeeModule {}
