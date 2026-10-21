import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Op, Transaction } from 'sequelize';
import User from '../user/entities/user.entity';
import UserRole from '../user-role/enitites/user-role.entity';
import Branch from '../branch/entities/branch.entity';
import TraineeMedication from '../trainee-medication/entities/trainee-medication.entity';
import {
  ActivityYear,
  BranchRegistrationPeriod,
  RegistrationForm,
  RegistrationFormDocument,
  RegistrationFormHistory,
  RegistrationFormVersion,
} from './entities/registration.entities';

export const ACTIVE_STATUSES = ['DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED'];
@Injectable()
export class RegistrationRepository {
  constructor(@InjectConnection() private readonly db: Sequelize) {}

  transaction<T>(work: (transaction: Transaction) => Promise<T>) {
    return this.db.transaction(work);
  }
  async lockTrainee(id: string, transaction: Transaction) {
    // Lock the existing parent row, including when no form exists yet.
    const user = await User.findByPk(id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!user || !user.isActive)
      throw new NotFoundException('Active trainee not found');
    const roles = await UserRole.findAll({
      where: { userId: id },
      transaction,
    });
    const branch =
      user.branchId && (await Branch.findByPk(user.branchId, { transaction }));
    if (!branch || !branch.isActive)
      throw new ConflictException('Trainee needs an active primary branch');
    return { user, roles };
  }
  years() {
    return ActivityYear.findAll({ order: [['startsOn', 'DESC']] });
  }
  async openYear(id: string, t: Transaction) {
    const year = await ActivityYear.findByPk(id, { transaction: t });
    const today = new Date().toISOString().slice(0, 10);
    if (!year || !year.isActive || today < year.startsOn || today > year.endsOn)
      throw new ConflictException('Activity year is not open');
    return year;
  }
  async annualRequirement(
    traineeUuid: string,
    branchId: string,
    t: Transaction,
  ) {
    const today = new Date().toISOString().slice(0, 10);
    const year = await ActivityYear.findOne({
      where: {
        isActive: true,
        startsOn: { [Op.lte]: today },
        endsOn: { [Op.gte]: today },
      },
      transaction: t,
    });
    if (!year) return null;
    const period = await BranchRegistrationPeriod.findOne({
      where: { branchId, activityYearId: year.id, status: 'OPEN' },
      transaction: t,
    });
    if (!period) return null;
    const approved = await RegistrationForm.findOne({
      where: {
        traineeUuid,
        branchId,
        activityYearId: year.id,
        requestType: 'YEARLY',
        status: 'APPROVED',
      },
      transaction: t,
    });
    return approved ? null : period;
  }
  active(traineeUuid: string, t: Transaction) {
    return RegistrationForm.findOne({
      where: { traineeUuid, status: { [Op.in]: ACTIVE_STATUSES } },
      transaction: t,
    });
  }
  latestApproved(traineeUuid: string, t: Transaction) {
    return RegistrationForm.findOne({
      where: { traineeUuid, status: 'APPROVED' },
      order: [['approvedAt', 'DESC']],
      transaction: t,
    });
  }
  async form(id: string, t: Transaction) {
    const row = await RegistrationForm.findByPk(id, { transaction: t });
    if (!row) throw new NotFoundException('Registration not found');
    return row;
  }
  async formReference(id: string, t: Transaction) {
    const row = await RegistrationForm.findByPk(id, {
      attributes: ['id', 'traineeUuid', 'branchId'],
      transaction: t,
    });
    if (!row) throw new NotFoundException('Registration not found');
    return row;
  }
  latestVersion(formId: string, t: Transaction) {
    return RegistrationFormVersion.findOne({
      where: { formId },
      order: [['versionNumber', 'DESC']],
      transaction: t,
    });
  }
  versions(formId: string, t: Transaction) {
    return RegistrationFormVersion.findAll({
      where: { formId },
      order: [['versionNumber', 'DESC']],
      transaction: t,
    });
  }
  idempotent(formId: string, idempotencyKey: string, t: Transaction) {
    return RegistrationFormVersion.findOne({
      where: { formId, idempotencyKey },
      transaction: t,
    });
  }
  documents(formId: string, t: Transaction) {
    return RegistrationFormDocument.findAll({
      where: { formId },
      transaction: t,
    });
  }
  medications(traineeUuid: string, t: Transaction) {
    return TraineeMedication.findAll({
      where: { traineeUuid },
      attributes: [
        'id',
        'medicationName',
        'dosage',
        'frequency',
        'schedule',
        'instructions',
        'isActive',
      ],
      transaction: t,
    });
  }
  createForm(values: Record<string, unknown>, t: Transaction) {
    return RegistrationForm.create(
      {
        draftRevision: 0,
        currentStep: 1,
        draftData: {},
        status: 'DRAFT',
        documentStatus: 'PENDING',
        ...values,
      },
      { transaction: t },
    );
  }
  createVersion(values: Record<string, unknown>, t: Transaction) {
    return RegistrationFormVersion.create(values, { transaction: t });
  }
  history(
    actorUuid: string,
    action: string,
    t: Transaction,
    refs: { formId?: string; versionId?: string; periodId?: string },
    metadata: Record<string, unknown> = {},
  ) {
    return RegistrationFormHistory.create(
      { actorUuid, action, ...refs, metadata },
      { transaction: t },
    );
  }
  async openPeriod(
    branchId: string,
    activityYearId: string,
    actor: string,
    t: Transaction,
  ) {
    const branch = await Branch.findByPk(branchId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!branch?.isActive)
      throw new NotFoundException('Active branch not found');
    const existing = await BranchRegistrationPeriod.findOne({
      where: { branchId, activityYearId },
      transaction: t,
    });
    if (existing) {
      if (existing.status !== 'OPEN')
        throw new ConflictException(
          'Closed periods require a separate reopening policy',
        );
      return existing;
    }
    const period = await BranchRegistrationPeriod.create(
      {
        branchId,
        activityYearId,
        status: 'OPEN',
        openedBy: actor,
        openedAt: new Date(),
      },
      { transaction: t },
    );
    await this.history(actor, 'ANNUAL_REGISTRATION_OPENED', t, {
      periodId: period.id,
    });
    return period;
  }
  list(filters: {
    branchIds?: string[];
    activityYearId?: string;
    status?: string;
    page: number;
    pageSize: number;
  }) {
    return RegistrationForm.findAndCountAll({
      where: {
        ...(filters.branchIds
          ? { branchId: { [Op.in]: filters.branchIds } }
          : {}),
        ...(filters.activityYearId
          ? { activityYearId: filters.activityYearId }
          : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      attributes: [
        'id',
        'traineeUuid',
        'branchId',
        'activityYearId',
        'requestType',
        'status',
        'documentStatus',
        'submittedAt',
        'approvedAt',
        'createdAt',
      ],
      order: [
        ['createdAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: filters.pageSize,
      offset: (filters.page - 1) * filters.pageSize,
    });
  }
}
