import { Module } from '@nestjs/common';
import Event from './entities/event.entity';
import EventService from './event.service';
import EventRepository from './event.repository';
import EventController from './event.controller';
import { SequelizeModule } from '@nestjs/sequelize';
import { AttendeeModule } from '../attendee/attendee.module';

@Module({
  imports: [SequelizeModule.forFeature([Event]), AttendeeModule],
  providers: [EventService, EventRepository],
  controllers: [EventController],
  exports: [EventService],
})
export class EventModule {}
