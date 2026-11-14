import { Module, forwardRef } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import Event from './entities/event.entity';
import EventService from './event.service';
import EventRepository from './event.repository';
import EventController from './event.controller';
import { EventImageUploadGuard } from './event-image-upload.guard';
import { AttendeeModule } from '../attendee/attendee.module';
import Attendee from '../attendee/entities/attendee.entity';
import EventPairing from '../attendee/entities/event-pairing.entity';
import { SupabaseStorageModule } from '../storage/supabase-storage.module';
import VolunteerActivity from '../activity/entities/activity.entity';
import ActivityRepository from '../activity/activity.repository';
import { AiModule } from '../ai/ai.module';
import CalendarMonthBackground from './entities/calendar-month-background.entity';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    SequelizeModule.forFeature([
      Event,
      Attendee,
      EventPairing,
      VolunteerActivity,
      CalendarMonthBackground,
    ]),
    forwardRef(() => AttendeeModule),
    SupabaseStorageModule,
    AiModule,
    EmailModule,
  ],
  providers: [
    EventService,
    EventRepository,
    ActivityRepository,
    EventImageUploadGuard,
  ],
  controllers: [EventController],
  exports: [EventService],
})
export class EventModule {}
