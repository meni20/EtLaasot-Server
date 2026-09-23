import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import type { Transaction } from 'sequelize';
import User from '../user/entities/user.entity';
import TraineeDocument from './entities/trainee-document.entity';
import { DocumentType } from './trainee-document.constants';

export interface DocumentMetadata {
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
}

@Injectable()
export class TraineeDocumentRepository {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  findAll(traineeUuid: string) {
    return TraineeDocument.findAll({
      where: { traineeUuid },
      order: [['documentType', 'ASC']],
    });
  }

  findOne(traineeUuid: string, documentType: DocumentType) {
    return TraineeDocument.findOne({ where: { traineeUuid, documentType } });
  }

  async isPathReferenced(traineeUuid: string, storagePath: string) {
    return this.sequelize.transaction(async (transaction) => {
      // Wait for a potentially ambiguous earlier COMMIT before deciding whether
      // its upload can be removed. If the outcome cannot be read, retain it.
      await this.lockTrainee(traineeUuid, transaction);
      return (
        (await TraineeDocument.count({ where: { storagePath }, transaction })) >
        0
      );
    });
  }

  private async lockTrainee(traineeUuid: string, transaction: Transaction) {
    // Parent locking also serializes first uploads, when no document row exists.
    const user = await User.findByPk(traineeUuid, {
      attributes: ['id'],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!user) throw new NotFoundException('Trainee not found');
  }

  replace(
    traineeUuid: string,
    documentType: DocumentType,
    metadata: DocumentMetadata,
  ) {
    return this.sequelize.transaction(async (transaction) => {
      await this.lockTrainee(traineeUuid, transaction);
      const existing = await TraineeDocument.findOne({
        where: { traineeUuid, documentType },
        transaction,
      });
      const previousPath = existing?.storagePath;
      const document = existing
        ? await existing.update(metadata, { transaction })
        : await TraineeDocument.create(
            { traineeUuid, documentType, ...metadata },
            { transaction },
          );
      return { document, previousPath };
    });
  }

  remove(traineeUuid: string, documentType: DocumentType) {
    return this.sequelize.transaction(async (transaction) => {
      await this.lockTrainee(traineeUuid, transaction);
      const document = await TraineeDocument.findOne({
        where: { traineeUuid, documentType },
        transaction,
      });
      if (!document) return null;
      const path = document.storagePath;
      await document.destroy({ transaction });
      return path;
    });
  }
}
