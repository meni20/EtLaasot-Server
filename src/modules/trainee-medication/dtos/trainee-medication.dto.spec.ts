import { BadRequestException, ParseUUIDPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateTraineeMedicationDto,
  UpdateTraineeMedicationDto,
} from './trainee-medication.dto';

describe('Trainee medication validation', () => {
  it('rejects a whitespace-only medication name', async () => {
    const dto = plainToInstance(CreateTraineeMedicationDto, {
      medicationName: '   ',
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('rejects an unsupported frequency', async () => {
    const dto = plainToInstance(CreateTraineeMedicationDto, {
      medicationName: 'Ritalin',
      frequency: 'EVERY_HOUR',
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('converts blank optional fields to null', async () => {
    const dto = plainToInstance(UpdateTraineeMedicationDto, {
      dosage: '   ',
      notes: '',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.dosage).toBeNull();
    expect(dto.notes).toBeNull();
  });

  it('rejects a malformed medication UUID', async () => {
    const pipe = new ParseUUIDPipe({ version: '4' });

    await expect(
      pipe.transform('not-a-uuid', {
        type: 'param',
        metatype: String,
        data: 'medicationId',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
