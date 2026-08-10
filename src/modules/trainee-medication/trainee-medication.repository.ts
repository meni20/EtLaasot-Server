import { Injectable } from '@nestjs/common';
import TraineeMedication from './entities/trainee-medication.entity';
import { ITraineeMedication } from './interfaces/trainee-medication.interface';

@Injectable()
export default class TraineeMedicationRepository {
  public findActiveByTrainee(traineeUuid: string) {
    return TraineeMedication.findAll({
      where: { traineeUuid, isActive: true },
      order: [
        ['medicationName', 'ASC'],
        ['createdAt', 'ASC'],
      ],
    });
  }

  public create(data: ITraineeMedication) {
    return TraineeMedication.create(data);
  }

  public findByIdForTrainee(id: string, traineeUuid: string) {
    return TraineeMedication.findOne({ where: { id, traineeUuid } });
  }

  public async update(
    medication: TraineeMedication,
    data: Partial<ITraineeMedication>,
  ) {
    return medication.update(data);
  }

  public async deactivate(medication: TraineeMedication) {
    await medication.update({ isActive: false });
    await medication.destroy();
    return medication;
  }
}
