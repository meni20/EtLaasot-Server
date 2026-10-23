import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import type { RegistrationData } from '../parent-registration/registration.validation';
export class IdentifyDto {
  @IsString() @Length(5, 9) identifier: string;
}
export class StartApplicationDto extends IdentifyDto {
  @IsString() @Length(1, 50) branchId: string;
}
export class RecoverApplicationDto {
  @IsString() @Length(43, 43) recoveryCode: string;
}
export class ApplicationDraftDto {
  @IsInt() @Min(0) revision: number;
  @IsInt() @Min(1) @Max(5) currentStep: number;
  @IsObject() data: RegistrationData;
}
export class SubmitApplicationDto {
  @IsInt() @Min(0) revision: number;
  @IsUUID('4') idempotencyKey: string;
}
export class ApplicationReviewDto {
  @IsString() @Length(1, 2000) reason: string;
}
export class ApplicationApprovalDto {
  @IsUUID('4') expectedVersionId: string;
  @Transform(({ obj, key }) => obj[key]) @IsBoolean() identityVerified: boolean;
}
export class ApplicationListDto {
  @IsOptional() @IsString() @Length(1, 50) branchId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(10000) page: number = 1;
}
