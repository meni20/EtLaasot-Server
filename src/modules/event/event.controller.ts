import { Body, Controller, Get, Post } from '@nestjs/common';
import EventService from './event.service';
import { IEvent } from './interfaces/event.interface';
import { CreateEventDto } from './dtos/event.dto';

@Controller('event')
export default class EventController {
  constructor(private readonly eventService: EventService) {}

  @Post()
  public async createEvent(@Body() eventData: CreateEventDto) {
    return await this.eventService.createEvent(eventData);
  }

  @Get('get-all-events')
  public async getAllEvents(): Promise<IEvent[]> {
    return await this.eventService.findAllEvents();
  }

  @Post('add-attendee')
  public async addAttendee(
    @Body() attendeeData: { userId: string; eventId: string },
  ) {
    return await this.eventService.addAttendee(
      attendeeData.userId,
      attendeeData.eventId,
    );
  }
}
