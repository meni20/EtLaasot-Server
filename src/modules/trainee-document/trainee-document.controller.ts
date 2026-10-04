import {
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TraineeDocumentAccessGuard } from './trainee-document-access.guard';
import type { DocumentRequest } from './trainee-document-access.guard';
import { DocumentType, MAX_DOCUMENT_SIZE } from './trainee-document.constants';
import { TraineeDocumentService } from './trainee-document.service';

// Both explicit route bases share the same handlers and guard. Only the admin
// base has a target parameter; self-service always resolves the authenticated ID.
@Controller(['user/me/documents', 'trainee/:traineeUuid/documents'])
@UseGuards(JwtAuthGuard, TraineeDocumentAccessGuard)
export class TraineeDocumentController {
  constructor(private readonly documents: TraineeDocumentService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Req() req: DocumentRequest) {
    return this.documents.list(req.documentTraineeUuid);
  }

  @Put(':documentType')
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(
    FileInterceptor('file', {
      // Busboy signals a limit at equality. Allow the inclusive product limit;
      // validation also enforces <= MAX_DOCUMENT_SIZE on the complete buffer.
      limits: {
        fileSize: MAX_DOCUMENT_SIZE + 1,
        files: 1,
        fields: 0,
        parts: 2,
      },
    }),
  )
  upload(
    @Req() req: DocumentRequest,
    @Param('documentType') type: DocumentType,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.documents.upload(req.documentTraineeUuid, type, file);
  }

  @Delete(':documentType')
  @Header('Cache-Control', 'private, no-store')
  remove(
    @Req() req: DocumentRequest,
    @Param('documentType') type: DocumentType,
  ) {
    return this.documents.remove(req.documentTraineeUuid, type);
  }

  @Get(':documentType/view')
  @Header('Cache-Control', 'private, no-store')
  view(@Req() req: DocumentRequest, @Param('documentType') type: DocumentType) {
    return this.documents.view(req.documentTraineeUuid, type);
  }
}
