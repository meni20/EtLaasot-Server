import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateUserDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(120)
  name: string;

  @Transform(({ value }) => (value === '' ? null : value))
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  age?: number | null;

  @IsOptional()
  @IsIn(['male', 'female'])
  gender?: 'male' | 'female' | null;

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
