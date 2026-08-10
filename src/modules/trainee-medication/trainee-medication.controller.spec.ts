import { ForbiddenException } from '@nestjs/common';
import { AuthorizationService } from '../auth/authorization.service';
import TraineeMedicationController from './trainee-medication.controller';
import TraineeMedicationService from './trainee-medication.service';

describe('TraineeMedicationController authorization', () => {
  const getByTrainee = jest.fn();
  const create = jest.fn();
  const update = jest.fn();
  const remove = jest.fn();
  const assertAdminForUserUuid = jest.fn();
  const controller = new TraineeMedicationController(
    {
      getByTrainee,
      create,
      update,
      remove,
    } as unknown as TraineeMedicationService,
    { assertAdminForUserUuid } as unknown as AuthorizationService,
  );
  const traineeUuid = '11111111-1111-4111-8111-111111111111';
  const medicationId = '22222222-2222-4222-8222-222222222222';
  const request = { user: { userId: 'admin-1' } };

  beforeEach(() => {
    jest.clearAllMocks();
    assertAdminForUserUuid.mockResolvedValue(undefined);
  });

  it('authorizes retrieval against the requested trainee UUID', async () => {
    getByTrainee.mockResolvedValue([]);

    await controller.getMedications(traineeUuid, request);

    expect(assertAdminForUserUuid).toHaveBeenCalledWith(
      request.user,
      traineeUuid,
    );
    expect(getByTrainee).toHaveBeenCalledWith(traineeUuid);
  });

  it('does not call the service when branch authorization fails', async () => {
    assertAdminForUserUuid.mockRejectedValue(
      new ForbiddenException('User access denied'),
    );

    await expect(
      controller.updateMedication(
        traineeUuid,
        medicationId,
        { dosage: '10 mg' },
        request,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it('passes both IDs to the ownership-enforcing delete service', async () => {
    remove.mockResolvedValue({ id: medicationId, isActive: false });

    await controller.deleteMedication(traineeUuid, medicationId, request);

    expect(remove).toHaveBeenCalledWith(traineeUuid, medicationId);
  });
});
