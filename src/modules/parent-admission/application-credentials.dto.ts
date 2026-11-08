import { Transform } from 'class-transformer';
import { IsIn, IsString, Length, Matches, MaxLength } from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import { isEmail } from 'class-validator';
import { REGISTRATION_TYPES, type RegistrationType } from './admission.policy';

export function normalizeApplicantEmail(value: unknown): string {
  if (typeof value !== 'string') throw new BadRequestException('Invalid email');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !isEmail(email, { allow_utf8_local_part: false }))
    throw new BadRequestException('Invalid email');
  return email;
}

export class ApplicantPasswordLoginDto {
  @Transform(({ obj, key }) => obj[key])
  @IsString()
  @Matches(/^\d{5,9}$/)
  identifier: string;

  // Preserve actual types even when global implicit conversion is enabled.
  @Transform(({ obj, key }) => obj[key])
  @IsString()
  @Length(1, 128)
  password: string;
}

export class ApplicantPasswordSignupDto extends ApplicantPasswordLoginDto {
  @Transform(({ obj, key }) => obj[key])
  @IsString()
  @MaxLength(254)
  email: string;

  @Transform(({ obj, key }) => obj[key])
  @IsString()
  @Length(1, 128)
  passwordConfirmation: string;

  @Transform(({ obj, key }) => obj[key])
  @IsIn(REGISTRATION_TYPES)
  registrationType: RegistrationType;
}
