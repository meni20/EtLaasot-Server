import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class UserDto {
  @IsNotEmpty()
  @IsString()
  id: string;

  @IsString()
  name: string;

  @IsString()
  phoneNumber: string;

  @IsIn(['male', 'female'])
  gender: 'male' | 'female';

  @IsString()
  address: string;

  @Transform(({ value }) => (value === '' ? null : value))
  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsNumber()
  age: number;

  @IsString()
  @IsOptional()
  branchId?: string;
}
