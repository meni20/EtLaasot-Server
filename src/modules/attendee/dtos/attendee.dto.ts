import { IsEnum, IsOptional } from 'class-validator';
import { AttendanceIntent, AttendeeRsvpStatus } from '../attendee.constants';

export class JoinEventDto {
  @IsOptional()
  @IsEnum(AttendeeRsvpStatus)
  rsvpStatus?: AttendeeRsvpStatus;
}

export class UpdateAttendanceIntentDto {
  @IsEnum(AttendanceIntent)
  intent: AttendanceIntent;
}

export class UpdateRsvpDto {
  @IsEnum(AttendeeRsvpStatus)
  rsvpStatus: AttendeeRsvpStatus;
}
