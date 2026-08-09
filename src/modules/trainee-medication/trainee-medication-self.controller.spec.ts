import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AUTH_ROLES } from 'src/constants/auth.constants';
import { AuthorizationService } from '../auth/authorization.service';
import TraineeMedicationSelfController from './trainee-medication-self.controller';
import TraineeMedicationService from './trainee-medication.service';

describe('TraineeMedicationSelfController', () => {
  const getByTrainee = jest.fn();
  const create = jest.fn();
  const update = jest.fn();
  const remove = jest.fn();
  const getActorId = jest.fn();
  const hasRole = jest.fn();
  const controller = new TraineeMedicationSelfController(
    {
      getByTrainee,
      create,
      update,
      remove,
    } as unknown as TraineeMedicationService,
    { getActorId, hasRole } as unknown as AuthorizationService,
  );
  const traineeUuid = '11111111-1111-4111-8111-111111111111';
  const medicationId = '22222222-2222-4222-8222-222222222222';
  const request = {
    user: {
      userId: traineeUuid,
      roles: [{ roleId: AUTH_ROLES.TRAINEE.id }],
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    getActorId.mockReturnValue(traineeUuid);
    hasRole.mockReturnValue(true);
  });

  it('loads medications using only the authenticated actor ID', async () => {
    getByTrainee.mockResolvedValue([]);

    await expect(controller.getMedications(request)).resolves.toEqual([]);

    expect(getActorId).toHaveBeenCalledWith(request.user);
    expect(hasRole).toHaveBeenCalledWith(request.user, AUTH_ROLES.TRAINEE.id);
    expect(getByTrainee).toHaveBeenCalledWith(traineeUuid);
  });

  it('creates a medication for the authenticated trainee', async () => {
    const dto = { medicationName: 'Ritalin' };
    create.mockResolvedValue({ id: medicationId, ...dto });

    await controller.createMedication(dto, request);

    expect(create).toHaveBeenCalledWith(traineeUuid, dto);
  });

  it('scopes updates to the authenticated trainee', async () => {
    const dto = { dosage: '10 mg' };
    update.mockResolvedValue({ id: medicationId, ...dto });

    await controller.updateMedication(medicationId, dto, request);

    expect(update).toHaveBeenCalledWith(traineeUuid, medicationId, dto);
  });

  it('does not reveal a medication owned by another trainee', async () => {
    update.mockRejectedValue(new NotFoundException('Medication not found'));

    await expect(
      controller.updateMedication(medicationId, { dosage: '10 mg' }, request),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(update).toHaveBeenCalledWith(traineeUuid, medicationId, {
      dosage: '10 mg',
    });
  });

  it('scopes deletion to the authenticated trainee', async () => {
    remove.mockResolvedValue({ id: medicationId, isActive: false });

    await controller.deleteMedication(medicationId, request);

    expect(remove).toHaveBeenCalledWith(traineeUuid, medicationId);
  });

  it('rejects volunteers before calling the medication service', async () => {
    hasRole.mockReturnValue(false);

    await expect(controller.getMedications(request)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(getByTrainee).not.toHaveBeenCalled();
  });

  it('rejects requests without an authenticated actor ID', async () => {
    getActorId.mockReturnValue(undefined);

    await expect(
      controller.createMedication({ medicationName: 'Ritalin' }, request),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(create).not.toHaveBeenCalled();
  });
});
