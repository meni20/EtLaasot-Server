import { Transform } from 'class-transformer';
import { IsIn, IsUUID } from 'class-validator';
import { PWA_PLATFORMS, type PwaPlatform } from '../pwa-installation.constants';

export class RegisterPwaInstallationDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsUUID('4')
  installationId: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsIn(PWA_PLATFORMS)
  platform: PwaPlatform;
}
