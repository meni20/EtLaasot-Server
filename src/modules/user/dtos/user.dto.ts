import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class UserDto {
  @IsNotEmpty()
  @IsString()
  id: string;

  @IsString()
  name: string;

  @IsString()
  phoneNumber: string;

  @IsString()
  address: string;

  @IsString()
  email: string;

  @IsNumber()
  age: number;
}
