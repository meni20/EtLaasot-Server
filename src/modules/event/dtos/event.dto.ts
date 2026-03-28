import { Type } from 'class-transformer';
import {
  IsString,
  IsDateString,
  IsOptional,
  IsNotEmpty,
  IsDate,
} from 'class-validator';

export class CreateEventDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  description: string;

  @IsDateString()
  startDate: Date;

  @IsDateString()
  endDate: Date;

  @IsString()
  address: string;

  @IsString()
  @IsOptional()
  eventType?: string;

  @IsString()
  @IsOptional()
  branchId?: string;
}
