import { Module, forwardRef } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import Event from './entities/event.entity';
import EventService from './event.service';
import EventRepository from './event.repository';
import EventController from './event.controller';
import { AttendeeModule } from '../attendee/attendee.module';
import Attendee from '../attendee/entities/attendee.entity';
import EventPairing from '../attendee/entities/event-pairing.entity';

@Module({
  imports: [
    SequelizeModule.forFeature([Event, Attendee, EventPairing]),
    forwardRef(() => AttendeeModule),
  ],
  providers: [EventService, EventRepository],
  controllers: [EventController],
  exports: [EventService],
})
export class EventModule {}
