import { Sequelize } from 'sequelize-typescript';
import User from '../user/entities/user.entity';
import TraineeDocument from './entities/trainee-document.entity';
import { TraineeDocumentRepository } from './trainee-document.repository';
import { DocumentType } from './trainee-document.constants';

describe('Document repository transactional serialization', () => {
  const transaction = { LOCK: { UPDATE: 'UPDATE' } };
  const run = jest.fn(async (callback) => callback(transaction));
  const repository = new TraineeDocumentRepository({
    transaction: run,
  } as unknown as Sequelize);
  const traineeUuid = '11111111-1111-4111-8111-111111111111';
  const documentType = DocumentType.QUEUE_EXEMPTION;
  const metadata = {
    storagePath: 'new',
    originalFilename: 'file.pdf',
    mimeType: 'application/pdf',
    fileSize: 30,
  };

  beforeEach(() => {
    jest.spyOn(User, 'findByPk').mockResolvedValue({ id: traineeUuid } as User);
  });
  afterEach(() => jest.restoreAllMocks());

  it('locks parent before reading/creating an initially absent slot', async () => {
    const find = jest.spyOn(TraineeDocument, 'findOne').mockResolvedValue(null);
    const create = jest
      .spyOn(TraineeDocument, 'create')
      .mockResolvedValue({ ...metadata } as any);
    await repository.replace(traineeUuid, documentType, metadata);
    expect(User.findByPk).toHaveBeenCalledWith(traineeUuid, {
      attributes: ['id'],
      transaction,
      lock: 'UPDATE',
    });
    expect(
      (User.findByPk as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan(find.mock.invocationCallOrder[0]);
    expect(create).toHaveBeenCalledWith(
      { traineeUuid, documentType, ...metadata },
      { transaction },
    );
  });

  it('updates the same slot and returns exactly the displaced path', async () => {
    const row = {
      storagePath: 'previous',
      update: jest.fn().mockResolvedValue({ ...metadata }),
    };
    jest.spyOn(TraineeDocument, 'findOne').mockResolvedValue(row as any);
    const result = await repository.replace(
      traineeUuid,
      documentType,
      metadata,
    );
    expect(row.update).toHaveBeenCalledWith(metadata, { transaction });
    expect(result.previousPath).toBe('previous');
  });

  it('deletes within the same parent-locked transaction and returns its object path', async () => {
    const row = {
      storagePath: 'previous',
      destroy: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(TraineeDocument, 'findOne').mockResolvedValue(row as any);
    await expect(repository.remove(traineeUuid, documentType)).resolves.toBe(
      'previous',
    );
    expect(TraineeDocument.findOne).toHaveBeenCalledWith({
      where: { traineeUuid, documentType },
      transaction,
    });
    expect(row.destroy).toHaveBeenCalledWith({ transaction });
  });

  it('does not create metadata for a missing/deleted user', async () => {
    jest.spyOn(User, 'findByPk').mockResolvedValue(null);
    const find = jest.spyOn(TraineeDocument, 'findOne');
    await expect(
      repository.replace(traineeUuid, documentType, metadata),
    ).rejects.toThrow('Trainee not found');
    expect(find).not.toHaveBeenCalled();
  });

  it('waits on the same lock when checking an ambiguous commit', async () => {
    const count = jest.spyOn(TraineeDocument, 'count').mockResolvedValue(1);
    await expect(repository.isPathReferenced(traineeUuid, 'new')).resolves.toBe(
      true,
    );
    expect(
      (User.findByPk as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan(count.mock.invocationCallOrder[0]);
    expect(count).toHaveBeenCalledWith({
      where: { storagePath: 'new' },
      transaction,
    });
  });
});
