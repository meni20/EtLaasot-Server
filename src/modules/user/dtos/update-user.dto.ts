import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpdateUserDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(120)
  name: string;

  @Transform(({ value }) => (value === '' ? null : value))
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  dateOfBirth?: string | null;

  @IsOptional()
  @IsIn(['male', 'female'])
  gender?: 'male' | 'female' | null;

  @IsOptional()
  @IsIn(['XS', 'S', 'M', 'L', 'XL', 'XXL', 'OTHER'])
  shirtSize?: 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL' | 'OTHER' | null;

  @Transform(({ value }) => (value === '' ? null : value))
  @IsOptional()
  @IsString()
  @MaxLength(50)
  customShirtSize?: string | null;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || null : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || null : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(100)
  parentName?: string | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  @Matches(/^(\+972|972|0)5\d{8}$/)
  phoneNumber: string;

  @Transform(({ value }) => (value === '' ? null : value))
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string | null;
}
