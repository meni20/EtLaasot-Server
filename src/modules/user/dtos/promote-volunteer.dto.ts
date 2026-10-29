import { IsString, Length } from 'class-validator';

export class PromoteVolunteerDto {
  @IsString()
  @Length(1, 50)
  branchId: string;
}
