import { Body, Controller, Post } from '@nestjs/common';
import AttendeeService from './attendee.service';

@Controller('attendee')
export default class AttendeeController {
  constructor(private readonly attendeeService: AttendeeService) {}

  @Post('add-attendee')
  public async addAttendee(
    @Body() attendeeData: { userId: string; eventId: string },
  ) {
    return await this.attendeeService.addAttendee(
      attendeeData.userId,
      attendeeData.eventId,
    );
  }
}
