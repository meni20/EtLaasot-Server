import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class PushSubscriptionKeysDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  p256dh: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  auth: string;
}

export class RegisterPushSubscriptionDto {
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  @MaxLength(4096)
  endpoint: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  expirationTime?: number | null;

  @IsObject()
  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys: PushSubscriptionKeysDto;
}

export class RemovePushSubscriptionDto {
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  @MaxLength(4096)
  endpoint: string;
}
