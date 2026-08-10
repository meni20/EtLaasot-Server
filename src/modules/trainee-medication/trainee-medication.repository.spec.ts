import TraineeMedication from './entities/trainee-medication.entity';
import TraineeMedicationRepository from './trainee-medication.repository';

describe('TraineeMedicationRepository', () => {
  const repository = new TraineeMedicationRepository();
  const traineeUuid = '11111111-1111-4111-8111-111111111111';
  const medicationId = '22222222-2222-4222-8222-222222222222';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns only active, non-soft-deleted medications for the trainee', async () => {
    const findAll = jest
      .spyOn(TraineeMedication, 'findAll')
      .mockResolvedValue([]);

    await repository.findActiveByTrainee(traineeUuid);

    expect(findAll).toHaveBeenCalledWith({
      where: { traineeUuid, isActive: true },
      order: [
        ['medicationName', 'ASC'],
        ['createdAt', 'ASC'],
      ],
    });
  });

  it('looks up a medication by both ID and authenticated trainee UUID', async () => {
    const findOne = jest
      .spyOn(TraineeMedication, 'findOne')
      .mockResolvedValue(null);

    await repository.findByIdForTrainee(medicationId, traineeUuid);

    expect(findOne).toHaveBeenCalledWith({
      where: { id: medicationId, traineeUuid },
    });
  });
});
