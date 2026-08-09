import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AUTH_ROLES } from 'src/constants/auth.constants';
import { AuthUser, AuthorizationService } from '../auth/authorization.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CreateTraineeMedicationDto,
  UpdateTraineeMedicationDto,
} from './dtos/trainee-medication.dto';
import TraineeMedicationService from './trainee-medication.service';

@Controller('user/me/medications')
@UseGuards(JwtAuthGuard)
export default class TraineeMedicationSelfController {
  constructor(
    private readonly medicationService: TraineeMedicationService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  @Get()
  public async getMedications(@Req() req: { user: AuthUser }) {
    return this.medicationService.getByTrainee(
      this.getAuthenticatedTraineeId(req.user),
    );
  }

  @Post()
  public async createMedication(
    @Body() dto: CreateTraineeMedicationDto,
    @Req() req: { user: AuthUser },
  ) {
    return this.medicationService.create(
      this.getAuthenticatedTraineeId(req.user),
      dto,
    );
  }

  @Patch(':medicationId')
  public async updateMedication(
    @Param('medicationId', new ParseUUIDPipe({ version: '4' }))
    medicationId: string,
    @Body() dto: UpdateTraineeMedicationDto,
    @Req() req: { user: AuthUser },
  ) {
    return this.medicationService.update(
      this.getAuthenticatedTraineeId(req.user),
      medicationId,
      dto,
    );
  }

  @Delete(':medicationId')
  public async deleteMedication(
    @Param('medicationId', new ParseUUIDPipe({ version: '4' }))
    medicationId: string,
    @Req() req: { user: AuthUser },
  ) {
    return this.medicationService.remove(
      this.getAuthenticatedTraineeId(req.user),
      medicationId,
    );
  }

  private getAuthenticatedTraineeId(user: AuthUser) {
    const actorId = this.authorizationService.getActorId(user);
    const isTrainee = this.authorizationService.hasRole(
      user,
      AUTH_ROLES.TRAINEE.id,
    );

    if (!actorId || !isTrainee) {
      throw new ForbiddenException('Trainee role is required');
    }

    return actorId;
  }
}
