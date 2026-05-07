import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { VolunteerActivityStatus } from '../activity.constants';

export class StartVolunteerActivityDto {
  @IsString()
  @IsNotEmpty()
  eventId: string;

  @IsString()
  @IsNotEmpty()
  traineeId: string;
}

export class EndVolunteerActivityDto {
  @IsOptional()
  @IsString()
  @MaxLength(1500)
  notes?: string;
}

export class VolunteerActivityHistoryQueryDto {
  @IsOptional()
  @IsString()
  limit?: string;
}

export class VolunteerActivityAdminQueryDto {
  @IsOptional()
  @IsString()
  volunteerId?: string;

  @IsOptional()
  @IsString()
  traineeId?: string;

  @IsOptional()
  @IsString()
  eventId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsEnum(VolunteerActivityStatus)
  status?: VolunteerActivityStatus;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

