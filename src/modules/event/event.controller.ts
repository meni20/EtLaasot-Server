import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import EventService from './event.service';
import { IEvent } from './interfaces/event.interface';
import { CreateEventDto } from './dtos/event.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('event')
@UseGuards(JwtAuthGuard)
export default class EventController {
  constructor(private readonly eventService: EventService) {}

  @Post('create-event')
  public async createEvent(@Body() eventData: CreateEventDto) {
    return await this.eventService.createEvent(eventData);
  }

  @Get('get-all-events')
  public async getAllEvents(
    @Query('branchId') branchId?: string,
  ): Promise<IEvent[]> {
    return await this.eventService.findAllEvents(branchId);
  }

  @Get('upcoming/:branchId')
  public async getUpcomingEvents(
    @Param('branchId') branchId: string,
    @Query('limit') limit?: string,
  ) {
    return await this.eventService.getUpcomingByBranch(
      branchId,
      Number(limit) || 5,
    );
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

  @Get('get-attendees-by-event/:eventId')
  public async getAttendeesByEvent(@Param('eventId') eventId: string) {
    return await this.eventService.getAllAttendeesByEvent(eventId);
  }
}
