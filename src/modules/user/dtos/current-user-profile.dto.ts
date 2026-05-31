import { IsEmail, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

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
}

export type CurrentUserProfileDto = {
  id: string;
  name: string;
  phoneNumber?: string | null;
  email?: string | null;
  address?: string | null;
  age?: number | null;
  branchId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
};
