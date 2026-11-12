import {
  Body,
  CanActivate,
  Controller,
  Delete,
  ExecutionContext,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import type { AuthUser } from '../auth/authorization.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AllowRegistrationAccess } from '../parent-registration/registration-request-access';
import { MAX_DOCUMENT_SIZE } from '../trainee-document/trainee-document.constants';
import { DiscountRequestService } from './discount-request.service';

type AuthRequest = Request & { user: AuthUser };

@Injectable()
export class DiscountRequestGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    http.getResponse<Response>().set({
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    // A cross-origin browser must pass the application's CORS preflight.
    if (req.method !== 'GET' && req.headers['x-discount-request'] !== '1') {
      throw new ForbiddenException();
    }
    return true;
  }
}

@Controller('user/me/discount-request')
@UseGuards(JwtAuthGuard, DiscountRequestGuard)
@AllowRegistrationAccess()
export class DiscountSelfController {
  constructor(private readonly service: DiscountRequestService) {}

  @Get('status')
  status(@Req() req: AuthRequest) {
    return this.service.selfStatus(req.user);
  }

  @Get('draft')
  draft(@Req() req: AuthRequest) {
    return this.service.draft(req.user);
  }

  @Put('draft')
  save(@Req() req: AuthRequest, @Body() input: unknown) {
    return this.service.save(req.user, input);
  }

  @Put('attachments/:key')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_DOCUMENT_SIZE + 1, files: 1, fields: 0, parts: 2 },
    }),
  )
  upload(
    @Req() req: AuthRequest,
    @Param('key') key: string,
    @Query('revision') revision: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.service.upload(req.user, key, revision, file);
  }

  @Delete('attachments/:key')
  remove(
    @Req() req: AuthRequest,
    @Param('key') key: string,
    @Query('revision') revision: string,
  ) {
    return this.service.remove(req.user, key, revision);
  }

  @Post('submit')
  @HttpCode(200)
  submit(@Req() req: AuthRequest, @Body() input: unknown) {
    return this.service.submit(req.user, input);
  }
}

@Controller('trainee/:id/discount-request')
@UseGuards(JwtAuthGuard, DiscountRequestGuard)
export class DiscountAdminController {
  constructor(private readonly service: DiscountRequestService) {}

  @Get()
  status(
    @Req() req: AuthRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.adminStatus(req.user, id);
  }

  @Put('enable')
  enable(
    @Req() req: AuthRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.enable(req.user, id);
  }

  @Get('files/:key')
  async download(
    @Req() req: AuthRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('key') key: string,
  ) {
    const { file, bytes } = await this.service.download(req.user, id, key);
    return new StreamableFile(bytes, {
      type: file.mimeType,
      disposition:
        "attachment; filename*=UTF-8''" +
        encodeURIComponent(file.originalFilename).replace(
          /['()*]/g,
          (value) => '%' + value.charCodeAt(0).toString(16),
        ),
      length: bytes.length,
    });
  }
}
