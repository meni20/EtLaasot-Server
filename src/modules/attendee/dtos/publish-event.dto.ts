import { IsISO8601, IsOptional, IsString } from "class-validator";

export class PublishEventDto {
  @IsString()
  name: string;

  @IsISO8601()
  startDate: string; 

  @IsISO8601()
  endDate: string;   

  @IsString()
  address: string;

  @IsString()
  description: string;
}
