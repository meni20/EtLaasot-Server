import { Injectable } from '@nestjs/common';
import { RegisterPwaInstallationDto } from './dtos/register-pwa-installation.dto';
import { PwaInstallationRepository } from './pwa-installation.repository';

@Injectable()
export class PwaInstallationService {
  constructor(private readonly repository: PwaInstallationRepository) {}

  async register(userUuid: string, dto: RegisterPwaInstallationDto) {
    await this.repository.register(userUuid, dto.installationId, dto.platform);
    return { registered: true };
  }
}
