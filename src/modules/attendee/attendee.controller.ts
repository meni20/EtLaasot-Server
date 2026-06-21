import {
  Body,
  Controller,
  Delete,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import AttendeeService from './attendee.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthorizationService } from '../auth/authorization.service';
import {
  JoinEventDto,
  UpdateAttendanceIntentDto,
  UpdateRsvpDto,
} from './dtos/attendee.dto';
import { AttendeeRsvpStatus } from './attendee.constants';

@Controller('attendee')
@UseGuards(JwtAuthGuard)
export default class AttendeeController {
  constructor(
    private readonly attendeeService: AttendeeService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  @Post(':eventId/join')
  public async joinEvent(
    @Param('eventId') eventId: string,
    @Body() body: JoinEventDto,
    @Req() req: any,
  ) {
    await this.authorizationService.assertBranchAccessForEvent(
      req.user,
      eventId,
    );
    const userId = req.user.sub ?? req.user.userId;
    return await this.attendeeService.joinEvent(
      userId,
      eventId,
      body.rsvpStatus ?? AttendeeRsvpStatus.CONFIRMED,
    );
  }

  @Post(':eventId/attendance-intent')
  public async updateAttendanceIntent(
    @Param('eventId') eventId: string,
    @Body() body: UpdateAttendanceIntentDto,
    @Req() req: any,
  ) {
    return await this.attendeeService.updateAttendanceIntent(
      eventId,
      body.intent,
      req.user,
    );
  }

  @Put(':attendeeId/rsvp')
  public async updateRsvp(
    @Param('attendeeId') attendeeId: string,
    @Body() body: UpdateRsvpDto,
    @Req() req: any,
  ) {
    await this.authorizationService.assertSelfAttendeeOrAdmin(
      req.user,
      attendeeId,
    );
    return await this.attendeeService.updateRsvp(attendeeId, body.rsvpStatus);
  }

  @Put(':attendeeId/checkin')
  public async checkIn(
    @Param('attendeeId') attendeeId: string,
    @Req() req: any,
  ) {
    await this.authorizationService.assertAdminForAttendee(
      req.user,
      attendeeId,
    );
    return await this.attendeeService.checkIn(attendeeId, req.user.userId);
  }

  @Delete(':attendeeId')
  public async deleteAttendee(
    @Param('attendeeId') attendeeId: string,
    @Req() req: any,
  ) {
    await this.authorizationService.assertAdminForAttendee(
      req.user,
      attendeeId,
    );
    return await this.attendeeService.deleteAttendee(attendeeId);
  }
}
