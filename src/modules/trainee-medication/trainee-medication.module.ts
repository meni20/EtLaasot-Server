import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import TraineeMedication from './entities/trainee-medication.entity';
import TraineeMedicationController from './trainee-medication.controller';
import TraineeMedicationRepository from './trainee-medication.repository';
import TraineeMedicationSelfController from './trainee-medication-self.controller';
import TraineeMedicationService from './trainee-medication.service';

@Module({
  imports: [SequelizeModule.forFeature([TraineeMedication])],
  controllers: [TraineeMedicationController, TraineeMedicationSelfController],
  providers: [TraineeMedicationService, TraineeMedicationRepository],
})
export class TraineeMedicationModule {}
