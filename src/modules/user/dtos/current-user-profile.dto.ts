import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateCurrentUserProfileDto {
  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Matches(/^[+\d\s()-]*$/)
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string | null;

  @IsOptional()
  @IsIn(['XS', 'S', 'M', 'L', 'XL', 'XXL', 'OTHER'])
  shirtSize?: 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL' | 'OTHER' | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  customShirtSize?: string | null;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || null : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  allergies?: string | null;
}

export type CurrentUserProfileDto = {
  id: string;
  nationalIdLast4?: string | null;
  nationalIdMasked?: string | null;
  name: string;
  phoneNumber?: string | null;
  gender?: 'male' | 'female' | null;
  email?: string | null;
  address?: string | null;
  age?: number | null;
  dateOfBirth?: string | null;
  shirtSize?: 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL' | 'OTHER' | null;
  customShirtSize?: string | null;
  allergies?: string | null;
  branchId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
};
