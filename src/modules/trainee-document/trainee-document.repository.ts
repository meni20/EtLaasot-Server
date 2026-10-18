import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Op } from 'sequelize';
import type { Transaction, WhereOptions } from 'sequelize';
import { AUTH_ROLES } from 'src/constants/auth.constants';
import Branch from '../branch/entities/branch.entity';
import User from '../user/entities/user.entity';
import UserRole from '../user-role/enitites/user-role.entity';
import TraineeDocument from './entities/trainee-document.entity';
import { DocumentType } from './trainee-document.constants';

export interface DocumentMetadata {
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
}

export interface AdminDocumentListQuery {
  branchIds?: string[];
  documentType?: DocumentType;
  search?: string;
  page: number;
  pageSize: number;
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

  findAdminDocuments(query: AdminDocumentListQuery) {
    const where: WhereOptions<TraineeDocument> = {};
    const filters: WhereOptions<TraineeDocument>[] = [];

    if (query.documentType) {
      filters.push({ documentType: query.documentType });
    }
    if (query.search) {
      filters.push({
        '$trainee.name$': { [Op.iLike]: `%${query.search}%` },
      });
    }
    if (query.branchIds) {
      filters.push({
        [Op.or]: [
          { '$trainee.branchId$': { [Op.in]: query.branchIds } },
          {
            '$trainee.userRoles.resourceId$': {
              [Op.in]: query.branchIds,
            },
          },
        ],
      });
    }
    if (filters.length) {
      where[Op.and] = filters;
    }

    return TraineeDocument.findAndCountAll({
      where,
      attributes: [
        'id',
        'traineeUuid',
        'documentType',
        'originalFilename',
        'mimeType',
        'fileSize',
        'createdAt',
        'updatedAt',
      ],
      include: [
        {
          model: User,
          as: 'trainee',
          required: true,
          attributes: ['id', 'name', 'branchId'],
          include: [
            {
              model: UserRole,
              required: true,
              attributes: ['resourceId'],
              where: { roleId: AUTH_ROLES.TRAINEE.id },
            },
            {
              model: Branch,
              required: false,
              attributes: ['id', 'name'],
            },
          ],
        },
      ],
      distinct: true,
      subQuery: false,
      order: [
        ['createdAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
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
