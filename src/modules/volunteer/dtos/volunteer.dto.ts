import {IsNotEmpty, IsNumber, IsString} from 'class-validator'

export class VolunteerDto {
    @IsNotEmpty()
    @IsString()
    id: string;

    @IsString()
    name: string;

    @IsNumber()
    phone: string;

    @IsString()
    traineeId: string;

    @IsString()
    address: string;
}