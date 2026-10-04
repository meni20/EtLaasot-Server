import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TraineeDocumentStorageService } from '../storage/trainee-document-storage.service';
import TraineeDocument from './entities/trainee-document.entity';
import type { TraineeDocumentDto } from './dtos/trainee-document.dto';
import { DocumentType } from './trainee-document.constants';
import { TraineeDocumentRepository } from './trainee-document.repository';
import { validateDocumentFile } from './trainee-document.validation';

@Injectable()
export class TraineeDocumentService {
  private readonly logger = new Logger(TraineeDocumentService.name);
  constructor(
    private readonly repository: TraineeDocumentRepository,
    private readonly storage: TraineeDocumentStorageService,
  ) {}

  async list(traineeUuid: string) {
    return (await this.repository.findAll(traineeUuid)).map((document) =>
      this.toDto(document),
    );
  }

  async upload(
    traineeUuid: string,
    type: DocumentType,
    file?: Express.Multer.File,
  ) {
    const { extension, ...metadata } = await validateDocumentFile(file);
    const storagePath = this.storage.buildPath(traineeUuid, type, extension);
    await this.storage.upload(storagePath, file!.buffer, metadata.mimeType);

    let result: Awaited<ReturnType<TraineeDocumentRepository['replace']>>;
    try {
      result = await this.repository.replace(traineeUuid, type, {
        ...metadata,
        storagePath,
      });
    } catch {
      // A connection failure at COMMIT can have an ambiguous outcome. Never
      // remove the new object until a fresh query proves it is not referenced.
      try {
        if (
          !(await this.repository.isPathReferenced(traineeUuid, storagePath))
        ) {
          await this.bestEffortRemove(storagePath, 'failed-upload');
        }
      } catch {
        this.logger.warn(
          'Document cleanup deferred: database outcome could not be verified',
        );
      }
      throw new InternalServerErrorException(
        'Failed to save document metadata',
      );
    }
    if (result.previousPath)
      await this.bestEffortRemove(result.previousPath, 'replacement');
    return this.toDto(result.document);
  }

  async remove(traineeUuid: string, type: DocumentType) {
    const path = await this.repository.remove(traineeUuid, type);
    if (path) await this.bestEffortRemove(path, 'deletion');
    return { ok: true };
  }

  async view(traineeUuid: string, type: DocumentType) {
    const document = await this.repository.findOne(traineeUuid, type);
    if (!document) throw new NotFoundException('Document not found');
    return this.storage.sign(document.storagePath);
  }

  private async bestEffortRemove(path: string, operation: string) {
    try {
      await this.storage.remove(path);
    } catch {
      // Do not log provider errors, object paths, filenames, or signed URLs.
      this.logger.warn(
        `Document storage cleanup failed (${operation}); an unreferenced object may remain`,
      );
    }
  }

  private toDto(document: TraineeDocument): TraineeDocumentDto {
    return {
      id: document.id,
      documentType: document.documentType,
      originalFilename: document.originalFilename,
      mimeType: document.mimeType,
      fileSize: document.fileSize,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }
}
