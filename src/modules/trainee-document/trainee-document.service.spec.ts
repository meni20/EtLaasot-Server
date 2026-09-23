import {
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TraineeDocumentService } from './trainee-document.service';
import { TraineeDocumentRepository } from './trainee-document.repository';
import { TraineeDocumentStorageService } from '../storage/trainee-document-storage.service';
import { DocumentType } from './trainee-document.constants';

describe('TraineeDocumentService lifecycle', () => {
  const trainee = '11111111-1111-4111-8111-111111111111';
  const type = DocumentType.ID_APPENDIX;
  const now = new Date();
  const row = {
    id: 'document-id',
    traineeUuid: trainee,
    documentType: type,
    storagePath: 'new-path',
    originalFilename: 'file.pdf',
    mimeType: 'application/pdf',
    fileSize: 20,
    createdAt: now,
    updatedAt: now,
  };
  const repository = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    replace: jest.fn(),
    remove: jest.fn(),
    isPathReferenced: jest.fn(),
  };
  const storage = {
    buildPath: jest.fn(),
    upload: jest.fn(),
    remove: jest.fn(),
    sign: jest.fn(),
  };
  const service = new TraineeDocumentService(
    repository as unknown as TraineeDocumentRepository,
    storage as unknown as TraineeDocumentStorageService,
  );
  const buffer = Buffer.from('%PDF-1.4\n%%EOF');
  const file = {
    buffer,
    size: buffer.length,
    originalname: 'file.pdf',
    mimetype: 'application/pdf',
  } as Express.Multer.File;

  beforeEach(() => {
    jest.resetAllMocks();
    storage.buildPath.mockReturnValue('new-path');
    storage.upload.mockResolvedValue(undefined);
    storage.remove.mockResolvedValue(undefined);
    repository.replace.mockResolvedValue({ document: row });
    repository.isPathReferenced.mockResolvedValue(false);
  });
  afterEach(() => jest.restoreAllMocks());

  it('uploads and returns only safe metadata', async () => {
    const result = await service.upload(trainee, type, file);
    expect(repository.replace).toHaveBeenCalledWith(
      trainee,
      type,
      expect.objectContaining({
        storagePath: 'new-path',
        fileSize: buffer.length,
      }),
    );
    expect(Object.keys(result).sort()).toEqual(
      [
        'id',
        'documentType',
        'originalFilename',
        'mimeType',
        'fileSize',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('does not remove the previous file until upload and DB replacement succeed', async () => {
    const order: string[] = [];
    storage.upload.mockImplementation(async () => {
      order.push('upload');
      expect(storage.remove).not.toHaveBeenCalled();
    });
    repository.replace.mockImplementation(async () => {
      order.push('commit');
      expect(storage.remove).not.toHaveBeenCalled();
      return { document: row, previousPath: 'old-path' };
    });
    storage.remove.mockImplementation(async () => {
      order.push('remove-old');
    });
    await service.upload(trainee, type, file);
    expect(order).toEqual(['upload', 'commit', 'remove-old']);
    expect(storage.remove).toHaveBeenCalledWith('old-path');
  });

  it('leaves metadata and old file untouched if storage upload fails', async () => {
    storage.upload.mockRejectedValue(new Error('upload failure'));
    await expect(service.upload(trainee, type, file)).rejects.toThrow();
    expect(repository.replace).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('removes only the newly uploaded file after DB failure', async () => {
    repository.replace.mockRejectedValue(new Error('database secret'));
    await expect(service.upload(trainee, type, file)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(repository.isPathReferenced).toHaveBeenCalledWith(
      trainee,
      'new-path',
    );
    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalledWith('new-path');
  });

  it.each(['referenced', 'unverifiable'])(
    'preserves new object when ambiguous commit is %s',
    async (outcome) => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      repository.replace.mockRejectedValue(new Error('connection lost'));
      if (outcome === 'referenced')
        repository.isPathReferenced.mockResolvedValue(true);
      else repository.isPathReferenced.mockRejectedValue(new Error('offline'));
      await expect(service.upload(trainee, type, file)).rejects.toThrow(
        'Failed to save document metadata',
      );
      expect(storage.remove).not.toHaveBeenCalled();
    },
  );

  it('commits deletion before deleting Storage and is idempotent for absent records', async () => {
    repository.remove.mockImplementation(async () => {
      expect(storage.remove).not.toHaveBeenCalled();
      return 'old-path';
    });
    await expect(service.remove(trainee, type)).resolves.toEqual({ ok: true });
    expect(storage.remove).toHaveBeenCalledWith('old-path');
    storage.remove.mockClear();
    repository.remove.mockResolvedValue(null);
    await service.remove(trainee, type);
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('never removes Storage if metadata deletion fails', async () => {
    repository.remove.mockRejectedValue(new Error('DB failure'));
    await expect(service.remove(trainee, type)).rejects.toThrow();
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('keeps successful replacement/deletion successful on cleanup failure and sanitizes logs', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    storage.remove.mockRejectedValue(
      new Error('SECRET path signedUrl filename'),
    );
    repository.replace.mockResolvedValue({
      document: row,
      previousPath: 'old-path',
    });
    await expect(service.upload(trainee, type, file)).resolves.toMatchObject({
      id: row.id,
    });
    repository.remove.mockResolvedValue('old-path');
    await expect(service.remove(trainee, type)).resolves.toEqual({ ok: true });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(
      /SECRET|old-path|signedUrl|filename/,
    );
  });

  it('lists no paths and signs only the selected trainee/type record', async () => {
    repository.findAll.mockResolvedValue([row]);
    expect((await service.list(trainee))[0]).not.toHaveProperty('storagePath');
    repository.findOne.mockResolvedValue(row);
    storage.sign.mockResolvedValue({
      signedUrl: 'temporary-url',
      expiresAt: now.toISOString(),
    });
    await expect(service.view(trainee, type)).resolves.toHaveProperty(
      'signedUrl',
    );
    expect(repository.findOne).toHaveBeenCalledWith(trainee, type);
    expect(storage.sign).toHaveBeenCalledWith('new-path');
    repository.findOne.mockResolvedValue(null);
    await expect(service.view(trainee, type)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
