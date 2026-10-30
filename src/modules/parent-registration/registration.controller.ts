import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseIntPipe,
  Res,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  ApproveDto,
  DraftDto,
  FormListDto,
  OpenPeriodDto,
  ReasonDto,
  RenewDto,
  SubmitDto,
} from './registration.dto';
import {
  RegistrationErrorInterceptor,
  RegistrationFeatureGuard,
} from './registration.guard';
import type { RegistrationRequest } from './registration.guard';
import { RegistrationService } from './registration.service';
import { AllowRegistrationAccess } from './registration-request-access';

@Controller('parent-registration')
@AllowRegistrationAccess()
@UseGuards(JwtAuthGuard, RegistrationFeatureGuard)
@UseInterceptors(RegistrationErrorInterceptor)
export class RegistrationController {
  constructor(private readonly service: RegistrationService) {}
  @Get('me/status') status(@Req() req: RegistrationRequest) {
    return this.service.status(req.user);
  }
  @Get('me') me(@Req() req: RegistrationRequest) {
    return this.service.me(req.user);
  }
  @Patch('me/draft') draft(
    @Req() req: RegistrationRequest,
    @Body() input: DraftDto,
  ) {
    return this.service.saveDraft(req.user, input);
  }
  @Post('me/submit') submit(
    @Req() req: RegistrationRequest,
    @Body() input: SubmitDto,
  ) {
    return this.service.submit(req.user, input);
  }
  @Post('me/attachments/:kind')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 3 },
    }),
  )
  attachment(
    @Req() req: RegistrationRequest,
    @Param('kind') kind: string,
    @Body('revision', ParseIntPipe) revision: number,
    @Body('signer') signer: 'parent1' | 'parent2' | undefined,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.upload(req.user, revision, kind, file?.buffer, signer);
  }
  @Post('me/pdf/retry') retry(@Req() req: RegistrationRequest) {
    return this.service.retry(req.user);
  }
  @Post('admin/forms/:formId/pdf/retry') adminRetry(
    @Req() req: RegistrationRequest,
    @Param('formId', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.adminRetry(req.user, id);
  }
  @Get('admin/forms/:formId/documents/:documentId') async document(
    @Req() req: RegistrationRequest,
    @Param('formId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('documentId', new ParseUUIDPipe({ version: '4' }))
    documentId: string,
    @Res() res: Response,
  ) {
    const result = await this.service.document(req.user, id, documentId);
    res
      .set({
        'Content-Type': result.mimeType,
        'Content-Disposition':
          'attachment; filename="registration-evidence.' +
          (result.mimeType === 'application/pdf'
            ? 'pdf'
            : result.mimeType === 'image/jpeg'
              ? 'jpg'
              : 'png') +
          '"',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(result.bytes);
  }
  @Get('me/feedback') feedback(@Req() req: RegistrationRequest) {
    return this.service.feedback(req.user);
  }
  @Post('admin/periods/open') open(
    @Req() req: RegistrationRequest,
    @Body() input: OpenPeriodDto,
  ) {
    return this.service.openPeriod(req.user, input);
  }
  @Get('admin/forms') list(
    @Req() req: RegistrationRequest,
    @Query() input: FormListDto,
  ) {
    return this.service.list(req.user, input);
  }
  @Get('admin/forms/:formId') detail(
    @Req() req: RegistrationRequest,
    @Param('formId', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.detail(req.user, id);
  }
  @Post('admin/forms/:formId/approve') approve(
    @Req() req: RegistrationRequest,
    @Param('formId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: ApproveDto,
  ) {
    return this.service.approve(req.user, id, input.expectedVersionId);
  }
  @Post('admin/forms/:formId/request-changes') changes(
    @Req() req: RegistrationRequest,
    @Param('formId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: ReasonDto,
  ) {
    return this.service.requestChanges(req.user, id, input.reason);
  }
  @Post('admin/trainees/:traineeId/renew') renew(
    @Req() req: RegistrationRequest,
    @Param('traineeId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: RenewDto,
  ) {
    return this.service.renew(req.user, id, input);
  }
}
@Controller('activity-years')
@AllowRegistrationAccess()
@UseGuards(JwtAuthGuard, RegistrationFeatureGuard)
@UseInterceptors(RegistrationErrorInterceptor)
export class ActivityYearController {
  constructor(private readonly service: RegistrationService) {}
  @Get() list() {
    return this.service.years();
  }
}
