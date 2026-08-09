import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AUTH_ROLES } from 'src/constants/auth.constants';
import User from '../user/entities/user.entity';
import TraineeMedicationRepository from './trainee-medication.repository';
import TraineeMedicationService from './trainee-medication.service';
import { MedicationFrequency } from './trainee-medication.constants';

describe('TraineeMedicationService', () => {
  const findActiveByTrainee = jest.fn();
  const create = jest.fn();
  const findByIdForTrainee = jest.fn();
  const update = jest.fn();
  const deactivate = jest.fn();
  const repository = {
    findActiveByTrainee,
    create,
    findByIdForTrainee,
    update,
    deactivate,
  } as unknown as TraineeMedicationRepository;
  const service = new TraineeMedicationService(repository);
  const traineeUuid = '11111111-1111-4111-8111-111111111111';
  const medicationId = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(User, 'findOne').mockResolvedValue({
      id: traineeUuid,
      userRoles: [{ roleId: AUTH_ROLES.TRAINEE.id }],
    } as User);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates a trimmed medication for a trainee', async () => {
    create.mockImplementation(async (payload) => payload);

    const result = await service.create(traineeUuid, {
      medicationName: '  Ritalin  ',
      dosage: ' 10 mg ',
      frequency: MedicationFrequency.ONCE_DAILY,
      schedule: ' 08:00 ',
      instructions: ' ',
      notes: null,
    });

    expect(create).toHaveBeenCalledWith({
      traineeUuid,
      medicationName: 'Ritalin',
      dosage: '10 mg',
      frequency: MedicationFrequency.ONCE_DAILY,
      schedule: '08:00',
      instructions: null,
      notes: null,
      isActive: true,
    });
    expect(result.medicationName).toBe('Ritalin');
  });

  it('retrieves active medications', async () => {
    findActiveByTrainee.mockResolvedValue([{ id: medicationId }]);

    await expect(service.getByTrainee(traineeUuid)).resolves.toEqual([
      { id: medicationId },
    ]);
    expect(findActiveByTrainee).toHaveBeenCalledWith(traineeUuid);
  });

  it('returns an empty array when the trainee has no medications', async () => {
    findActiveByTrainee.mockResolvedValue([]);

    await expect(service.getByTrainee(traineeUuid)).resolves.toEqual([]);
  });

  it('updates only a medication owned by the trainee', async () => {
    const medication = { id: medicationId };
    findByIdForTrainee.mockResolvedValue(medication);
    update.mockImplementation(async (_medication, payload) => payload);

    await service.update(traineeUuid, medicationId, {
      dosage: ' 5 ml ',
      notes: ' ',
    });

    expect(findByIdForTrainee).toHaveBeenCalledWith(medicationId, traineeUuid);
    expect(update).toHaveBeenCalledWith(medication, {
      dosage: '5 ml',
      notes: null,
    });
  });

  it('soft-deletes and deactivates an owned medication', async () => {
    const medication = { id: medicationId, traineeUuid };
    findByIdForTrainee.mockResolvedValue(medication);
    deactivate.mockResolvedValue({ ...medication, isActive: false });

    await expect(service.remove(traineeUuid, medicationId)).resolves.toEqual({
      id: medicationId,
      traineeUuid,
      isActive: false,
    });
    expect(deactivate).toHaveBeenCalledWith(medication);
  });

  it('rejects a medication ID that belongs to another trainee', async () => {
    findByIdForTrainee.mockResolvedValue(null);

    await expect(
      service.update(traineeUuid, medicationId, { dosage: '10 mg' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects deletion when the medication belongs to another trainee', async () => {
    findByIdForTrainee.mockResolvedValue(null);

    await expect(
      service.remove(traineeUuid, medicationId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(deactivate).not.toHaveBeenCalled();
  });

  it('rejects whitespace-only medication names at the service boundary', async () => {
    await expect(
      service.create(traineeUuid, { medicationName: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a missing trainee', async () => {
    jest.mocked(User.findOne).mockResolvedValue(null);

    await expect(service.getByTrainee(traineeUuid)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects a user without the trainee role', async () => {
    jest.mocked(User.findOne).mockResolvedValue({
      id: traineeUuid,
      userRoles: [{ roleId: AUTH_ROLES.VOLUNTEER.id }],
    } as User);

    await expect(service.getByTrainee(traineeUuid)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
