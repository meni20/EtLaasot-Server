import { Controller, Get, Header, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthorizationService } from '../auth/authorization.service';
import type { AuthUser } from '../auth/authorization.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminTraineeDocumentQueryDto } from './dtos/admin-trainee-document-query.dto';
import { TraineeDocumentService } from './trainee-document.service';

type AdminDocumentRequest = Request & { user: AuthUser };

@Controller('trainee/documents')
@UseGuards(JwtAuthGuard)
export class TraineeDocumentAdminController {
  constructor(
    private readonly documents: TraineeDocumentService,
    private readonly authorization: AuthorizationService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(
    @Req() req: AdminDocumentRequest,
    @Query() query: AdminTraineeDocumentQueryDto,
  ) {
    const branchIds = this.authorization.resolveAdminBranchScope(
      req.user,
      query.branchId,
    );
    return this.documents.listAdmin({ ...query, branchIds });
  }
}
