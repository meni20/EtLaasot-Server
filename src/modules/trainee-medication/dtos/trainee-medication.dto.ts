import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { MedicationFrequency } from '../trainee-medication.constants';

const trimRequired = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const trimOptional = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

export class CreateTraineeMedicationDto {
  @Transform(trimRequired)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  medicationName: string;

  @Transform(trimOptional)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  dosage?: string | null;

  @Transform(trimOptional)
  @IsOptional()
  @IsEnum(MedicationFrequency)
  frequency?: MedicationFrequency | null;

  @Transform(trimOptional)
  @IsOptional()
  @IsString()
  @MaxLength(300)
  schedule?: string | null;

  @Transform(trimOptional)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string | null;

  @Transform(trimOptional)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class UpdateTraineeMedicationDto {
  @Transform(trimRequired)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  medicationName?: string;

  @Transform(trimOptional)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  dosage?: string | null;

  @Transform(trimOptional)
  @IsOptional()
  @IsEnum(MedicationFrequency)
  frequency?: MedicationFrequency | null;

  @Transform(trimOptional)
  @IsOptional()
  @IsString()
  @MaxLength(300)
  schedule?: string | null;

  @Transform(trimOptional)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string | null;

  @Transform(trimOptional)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
