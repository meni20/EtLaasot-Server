import {
  Body,
  Controller,
  Get,
  Delete,
  Put,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import EventService from './event.service';
import { CreateEventDto } from './dtos/event.dto';
import { IEvent } from './interfaces/event.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthorizationService } from '../auth/authorization.service';

@Controller('event')
@UseGuards(JwtAuthGuard)
export default class EventController {
  constructor(
    private readonly eventService: EventService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  @Post('create-event')
  public async createEvent(@Body() eventData: CreateEventDto, @Req() req: any) {
    this.authorizationService.assertAdminForBranch(
      req.user,
      eventData.branchId ?? '',
    );
    return await this.eventService.createEvent(eventData);
  }

  @Put('update-event/:id')
public async updateEvent(
  @Param('id') id: string,
  @Body() eventData: CreateEventDto,
  @Req() req: any,
) {
  const eventBranchId = await this.authorizationService.assertAdminForEvent(
    req.user,
    id,
  );

  if (eventData.branchId && eventData.branchId !== eventBranchId) {
    this.authorizationService.assertSuperAdmin(req.user);
  }

  return await this.eventService.updateEvent(id, eventData);
}

  @Get('get-all-events')
  public async getAllEvents(
    @Query('branchId') branchId?: string,
    @Req() req?: any,
  ): Promise<IEvent[]> {
    if (branchId) {
      this.authorizationService.assertBranchAccess(req.user, branchId);
    } else {
      this.authorizationService.assertSuperAdmin(req.user);
    }

    return await this.eventService.findAllEvents(branchId);
  }

  @Get('upcoming/:branchId')
  public async getUpcomingEvents(
    @Param('branchId') branchId: string,
    @Query('limit') limit?: string,
    @Req() req?: any,
  ) {
    this.authorizationService.assertBranchAccess(req.user, branchId);
    return await this.eventService.getUpcomingByBranch(
      branchId,
      Number(limit) || 5,
    );
  }

  @Post('add-attendee')
  public async addAttendee(
    @Body() attendeeData: { userId: string; eventId: string },
    @Req() req: any,
  ) {
    const branchId = await this.authorizationService.assertAdminForEvent(
      req.user,
      attendeeData.eventId,
    );
    await this.authorizationService.assertUserBelongsToBranch(
      attendeeData.userId,
      branchId,
    );

    return await this.eventService.addAttendee(
      attendeeData.userId,
      attendeeData.eventId,
    );
  }

  @Get('get-attendees-by-event/:eventId')
  public async getAttendeesByEvent(
    @Param('eventId') eventId: string,
    @Req() req: any,
  ) {
    await this.authorizationService.assertAdminForEvent(req.user, eventId);
    return await this.eventService.getAllAttendeesByEvent(eventId);
  }

  @Get(':eventId/participants')
  public async getParticipantsByEvent(
    @Param('eventId') eventId: string,
    @Req() req: any,
  ) {
    return await this.eventService.getParticipantsByEvent(eventId, req.user);
  }

  @Post(':eventId/pairings')
  public async createManualPairing(
    @Param('eventId') eventId: string,
    @Body() body: { mentorId: string; traineeId: string },
    @Req() req: any,
  ) {
    return await this.eventService.createManualPairing(
      eventId,
      body.mentorId,
      body.traineeId,
      req.user,
    );
  }

  @Delete(':eventId/pairings/:pairingId')
  public async deletePairing(
    @Param('eventId') eventId: string,
    @Param('pairingId') pairingId: string,
    @Req() req: any,
  ) {
    return await this.eventService.deletePairingWithAttendees(
      eventId,
      pairingId,
      req.user,
    );
  }
}
