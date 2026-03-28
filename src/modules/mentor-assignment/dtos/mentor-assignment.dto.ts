import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateMentorAssignmentDto {
  @IsString()
  @IsNotEmpty()
  mentorId: string;

  @IsString()
  @IsNotEmpty()
  traineeId: string;

  @IsString()
  @IsNotEmpty()
  branchId: string;
}

export class TransferTraineeDto {
  @IsString()
  @IsNotEmpty()
  newMentorId: string;
}
