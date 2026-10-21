import {
  IsBoolean,
  IsIn,
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
import type { RegistrationData } from './registration.validation';

export class DraftDto {
  @IsInt() @Min(0) revision: number;
  @IsInt() @Min(1) @Max(5) currentStep: number;
  // Full partial draft replacement, not a recursive merge. Omitted fields are removed.
  @IsObject() data: RegistrationData;
}
export class SubmitDto {
  @IsUUID('4') formId: string;
  @IsInt() @Min(0) revision: number;
  @IsUUID('4') idempotencyKey: string;
}
export class OpenPeriodDto {
  @IsString() @Length(1, 50) branchId: string;
  @IsUUID('4') activityYearId: string;
}
export class ReasonDto {
  @IsString() @Length(1, 2000) reason: string;
}
export class ApproveDto {
  @IsUUID('4') expectedVersionId: string;
}
export class RenewDto extends ReasonDto {
  @Transform(({ obj, key }) => obj[key])
  @IsBoolean()
  blocksAccess: boolean;
  @IsString() @Length(1, 50) branchId: string;
  @IsUUID('4') activityYearId: string;
}
export class FormListDto {
  @IsOptional() @IsString() @Length(1, 50) branchId?: string;
  @IsOptional() @IsUUID('4') activityYearId?: string;
  @IsOptional()
  @IsIn(['DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED'])
  status?: string;
  @IsOptional() @IsInt() @Min(1) page = 1;
  @IsOptional() @IsInt() @Min(1) @Max(100) pageSize = 25;
}
