import { REGISTRATION_TYPES, type RegistrationType } from './admission.policy';
import {
  IsBoolean,
  IsInt,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
import type { ApplicationFormData } from './admission.policy';
import {
  normalizeRecoveryCode,
  RECOVERY_CODE_PATTERN,
} from './admission.security';
export class IdentifyDto {
  @IsString() @Length(5, 9) identifier: string;
}
export class StartApplicationDto extends IdentifyDto {
  @IsIn(REGISTRATION_TYPES) registrationType: RegistrationType = 'TRAINEE';
  @IsString() @Length(1, 50) branchId: string;
}
export class RecoverApplicationDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? normalizeRecoveryCode(value) : value,
  )
  @IsString()
  @Matches(RECOVERY_CODE_PATTERN)
  recoveryCode: string;
}
export class ReissueRecoveryCodeDto {
  @Transform(({ obj, key }) => obj[key]) @IsBoolean() identityVerified: boolean;
}
export class ApplicationDraftDto {
  @IsInt() @Min(0) revision: number;
  @IsInt() @Min(1) @Max(5) currentStep: number;
  @IsObject() data: ApplicationFormData<RegistrationType>;
}
export class SubmitApplicationDto {
  @IsInt() @Min(0) revision: number;
  @IsUUID('4') idempotencyKey: string;
}
export class ApplicationReviewDto {
  @IsUUID('4') expectedVersionId: string;
  @IsString() @Length(1, 2000) reason: string;
}
export class ApplicationApprovalDto {
  @IsUUID('4') expectedVersionId: string;
  @Transform(({ obj, key }) => obj[key]) @IsBoolean() identityVerified: boolean;
}
export class ApplicationListDto {
  @IsIn([...REGISTRATION_TYPES, 'ALL']) registrationType:
    | RegistrationType
    | 'ALL' = 'TRAINEE';
  @IsOptional()
  @IsIn([
    'DRAFT',
    'PENDING_REVIEW',
    'CHANGES_REQUESTED',
    'REJECTED',
    'APPROVED',
  ])
  status?: string;
  @IsOptional() @IsString() @Length(0, 100) search?: string;
  @IsOptional() @IsString() @Length(1, 50) branchId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(10000) page: number = 1;
}
