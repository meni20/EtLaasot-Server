import { Transform } from 'class-transformer';
import {
  IsIn,
  IsString,
  IsDateString,
  IsOptional,
  IsNotEmpty,
  ValidateIf,
} from 'class-validator';
import { EVENT_TYPE_IDS } from 'src/constants/auth.constants';
import { EVENT_AUDIENCES, type EventAudience } from '../event-audience';

export class CreateEventDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(EVENT_AUDIENCES)
  audience?: EventAudience;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  description: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsString()
  address: string;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  @IsOptional()
  @IsIn(EVENT_TYPE_IDS)
  eventType?: string;

  @IsString()
  @IsOptional()
  branchId?: string;
}
