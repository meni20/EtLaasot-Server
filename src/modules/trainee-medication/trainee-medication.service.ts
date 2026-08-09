import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AUTH_ROLES } from 'src/constants/auth.constants';
import User from '../user/entities/user.entity';
import UserRole from '../user-role/enitites/user-role.entity';
import {
  CreateTraineeMedicationDto,
  UpdateTraineeMedicationDto,
} from './dtos/trainee-medication.dto';
import { ITraineeMedication } from './interfaces/trainee-medication.interface';
import TraineeMedicationRepository from './trainee-medication.repository';

@Injectable()
export default class TraineeMedicationService {
  constructor(
    private readonly medicationRepository: TraineeMedicationRepository,
  ) {}

  public async getByTrainee(traineeUuid: string) {
    await this.assertTrainee(traineeUuid);
    return this.medicationRepository.findActiveByTrainee(traineeUuid);
  }

  public async create(traineeUuid: string, dto: CreateTraineeMedicationDto) {
    await this.assertTrainee(traineeUuid);
    const medicationName = dto.medicationName?.trim();
    if (!medicationName) {
      throw new BadRequestException('Medication name is required');
    }

    return this.medicationRepository.create({
      traineeUuid,
      medicationName,
      dosage: this.normalizeOptional(dto.dosage),
      frequency: dto.frequency ?? null,
      schedule: this.normalizeOptional(dto.schedule),
      instructions: this.normalizeOptional(dto.instructions),
      notes: this.normalizeOptional(dto.notes),
      isActive: true,
    });
  }

  public async update(
    traineeUuid: string,
    medicationId: string,
    dto: UpdateTraineeMedicationDto,
  ) {
    await this.assertTrainee(traineeUuid);
    const medication = await this.getOwnedMedication(traineeUuid, medicationId);
    const updateData = this.buildUpdateData(dto);

    if (Object.keys(updateData).length === 0) {
      throw new BadRequestException(
        'At least one medication field is required',
      );
    }

    return this.medicationRepository.update(medication, updateData);
  }

  public async remove(traineeUuid: string, medicationId: string) {
    await this.assertTrainee(traineeUuid);
    const medication = await this.getOwnedMedication(traineeUuid, medicationId);
    const removed = await this.medicationRepository.deactivate(medication);

    return {
      id: removed.id,
      traineeUuid: removed.traineeUuid,
      isActive: false,
    };
  }

  private async assertTrainee(traineeUuid: string) {
    const trainee = await User.findOne({
      where: { id: traineeUuid },
      attributes: ['id'],
      include: [{ model: UserRole, attributes: ['roleId'] }],
    });

    if (!trainee) {
      throw new NotFoundException('Trainee not found');
    }

    const isTrainee = trainee.userRoles?.some(
      (role) => Number(role.roleId) === AUTH_ROLES.TRAINEE.id,
    );
    if (!isTrainee) {
      throw new BadRequestException('User is not a trainee');
    }
  }

  private async getOwnedMedication(traineeUuid: string, medicationId: string) {
    const medication = await this.medicationRepository.findByIdForTrainee(
      medicationId,
      traineeUuid,
    );
    if (!medication) {
      throw new NotFoundException('Medication not found for trainee');
    }
    return medication;
  }

  private buildUpdateData(dto: UpdateTraineeMedicationDto) {
    const data: Partial<ITraineeMedication> = {};

    if (Object.prototype.hasOwnProperty.call(dto, 'medicationName')) {
      const medicationName = dto.medicationName?.trim();
      if (!medicationName) {
        throw new BadRequestException('Medication name is required');
      }
      data.medicationName = medicationName;
    }
    if (Object.prototype.hasOwnProperty.call(dto, 'dosage')) {
      data.dosage = this.normalizeOptional(dto.dosage);
    }
    if (Object.prototype.hasOwnProperty.call(dto, 'frequency')) {
      data.frequency = dto.frequency ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(dto, 'schedule')) {
      data.schedule = this.normalizeOptional(dto.schedule);
    }
    if (Object.prototype.hasOwnProperty.call(dto, 'instructions')) {
      data.instructions = this.normalizeOptional(dto.instructions);
    }
    if (Object.prototype.hasOwnProperty.call(dto, 'notes')) {
      data.notes = this.normalizeOptional(dto.notes);
    }

    return data;
  }

  private normalizeOptional(value?: string | null) {
    return value?.trim() || null;
  }
}
