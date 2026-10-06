import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import PwaInstallation from './entities/pwa-installation.entity';
import { PwaInstallationController } from './pwa-installation.controller';
import { PwaInstallationRepository } from './pwa-installation.repository';
import { PwaInstallationService } from './pwa-installation.service';

@Module({
  imports: [SequelizeModule.forFeature([PwaInstallation])],
  controllers: [PwaInstallationController],
  providers: [PwaInstallationService, PwaInstallationRepository],
})
export class PwaInstallationModule {}
