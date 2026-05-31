import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import ActivityService from './activity.service';
import {
  EndVolunteerActivityDto,
  StartVolunteerActivityDto,
  VolunteerActivityAdminQueryDto,
  VolunteerActivityHistoryQueryDto,
} from './dtos/activity.dto';

@Controller('activity')
@UseGuards(JwtAuthGuard)
export default class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @Post('start')
  public startActivity(
    @Req() req: any,
    @Body() dto: StartVolunteerActivityDto,
  ) {
    return this.activityService.startActivity(req.user, dto);
  }

  @Patch('end/:activityId')
  public endActivity(
    @Req() req: any,
    @Param('activityId') activityId: string,
    @Body() dto: EndVolunteerActivityDto,
  ) {
    return this.activityService.endActivity(req.user, activityId, dto);
  }

  @Get('my-active')
  public getMyActiveActivity(@Req() req: any) {
    return this.activityService.getMyActiveActivity(req.user);
  }

  @Get('my-history')
  public getMyHistory(
    @Req() req: any,
    @Query() query: VolunteerActivityHistoryQueryDto,
  ) {
    return this.activityService.getMyHistory(req.user, query.limit);
  }

  @Get('my-yearly-summary')
  public getMyYearlySummary(@Req() req: any) {
    return this.activityService.getMyYearlySummary(req.user);
  }

  @Get('admin')
  public getAdminActivities(
    @Req() req: any,
    @Query() query: VolunteerActivityAdminQueryDto,
  ) {
    return this.activityService.getAdminActivities(req.user, query);
  }

  @Get('admin/:activityId')
  public getAdminActivityById(
    @Req() req: any,
    @Param('activityId') activityId: string,
  ) {
    return this.activityService.getAdminActivityById(req.user, activityId);
  }

  @Get('event/:eventId/attendance')
  public getEventAttendance(
    @Req() req: any,
    @Param('eventId') eventId: string,
  ) {
    return this.activityService.getEventAttendance(req.user, eventId);
  }

  @Delete('event/:eventId/attendance/:volunteerId')
  public removeEventAttendance(
    @Req() req: any,
    @Param('eventId') eventId: string,
    @Param('volunteerId') volunteerId: string,
  ) {
    return this.activityService.removeEventAttendance(
      req.user,
      eventId,
      volunteerId,
    );
  }
}
