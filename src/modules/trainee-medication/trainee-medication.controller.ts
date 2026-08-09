import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthorizationService } from '../auth/authorization.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CreateTraineeMedicationDto,
  UpdateTraineeMedicationDto,
} from './dtos/trainee-medication.dto';
import TraineeMedicationService from './trainee-medication.service';

@Controller('trainee')
@UseGuards(JwtAuthGuard)
export default class TraineeMedicationController {
  constructor(
    private readonly medicationService: TraineeMedicationService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  @Get(':traineeUuid/medications')
  public async getMedications(
    @Param('traineeUuid', new ParseUUIDPipe({ version: '4' }))
    traineeUuid: string,
    @Req() req: any,
  ) {
    await this.authorizationService.assertAdminForUserUuid(
      req.user,
      traineeUuid,
    );
    return this.medicationService.getByTrainee(traineeUuid);
  }

  @Post(':traineeUuid/medications')
  public async createMedication(
    @Param('traineeUuid', new ParseUUIDPipe({ version: '4' }))
    traineeUuid: string,
    @Body() dto: CreateTraineeMedicationDto,
    @Req() req: any,
  ) {
    await this.authorizationService.assertAdminForUserUuid(
      req.user,
      traineeUuid,
    );
    return this.medicationService.create(traineeUuid, dto);
  }

  @Patch(':traineeUuid/medications/:medicationId')
  public async updateMedication(
    @Param('traineeUuid', new ParseUUIDPipe({ version: '4' }))
    traineeUuid: string,
    @Param('medicationId', new ParseUUIDPipe({ version: '4' }))
    medicationId: string,
    @Body() dto: UpdateTraineeMedicationDto,
    @Req() req: any,
  ) {
    await this.authorizationService.assertAdminForUserUuid(
      req.user,
      traineeUuid,
    );
    return this.medicationService.update(traineeUuid, medicationId, dto);
  }

  @Delete(':traineeUuid/medications/:medicationId')
  public async deleteMedication(
    @Param('traineeUuid', new ParseUUIDPipe({ version: '4' }))
    traineeUuid: string,
    @Param('medicationId', new ParseUUIDPipe({ version: '4' }))
    medicationId: string,
    @Req() req: any,
  ) {
    await this.authorizationService.assertAdminForUserUuid(
      req.user,
      traineeUuid,
    );
    return this.medicationService.remove(traineeUuid, medicationId);
  }
}
