import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Op, QueryTypes, Transaction } from 'sequelize';
import { getBooleanEnv } from '../../config/env.util';
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

export const ACTIVE_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'CHANGES_REQUESTED',
] as const;
export type TraineeFormStatus = (typeof ACTIVE_STATUSES)[number] | 'APPROVED';
export type TraineeFormPdf = {
  source: 'RENEWAL' | 'APPLICATION';
  formId: string;
  documentId: string;
};
export type TraineeFormSummary = {
  status: TraineeFormStatus;
  pdf: TraineeFormPdf | null;
};

// One bounded metadata query for the already-authorized trainee list. No form
// contents, medical data, signatures or per-trainee API/database calls.
export async function traineeFormStatuses(
  db: Sequelize,
  trainees: Array<{ id: string; branchId?: string | null }>,
): Promise<Map<string, TraineeFormSummary>> {
  if (!trainees.length) return new Map();
  const applications = getBooleanEnv('PARENT_ADMISSION_SCHEMA_READY', false)
    ? `UNION ALL
       SELECT a.provisioned_user_id AS trainee_uuid, a.status, 0 AS priority,
              a.reviewed_at AS changed_at, a.id, 'APPLICATION' AS source,
              (SELECT e.id
               FROM public.trainee_application_versions v
               JOIN public.trainee_application_evidence e
                 ON e.application_id=v.application_id AND e.version_id=v.id
               WHERE v.application_id=a.id AND e.kind='REGISTRATION_PDF'
                 AND e.mime_type='application/pdf' AND e.verified_at IS NOT NULL
               ORDER BY v.version_number DESC LIMIT 1) AS pdf_document_id
       FROM public.trainee_applications a
       JOIN listed l ON l.id=a.provisioned_user_id AND l.branch_id=a.branch_id
       JOIN current_year y ON y.id=a.approved_activity_year_id
       WHERE a.status='APPROVED'`
    : '';
  const rows = await db.query<{
    traineeUuid: string;
    status: TraineeFormStatus;
    source: TraineeFormPdf['source'];
    formId: string;
    documentId: string | null;
  }>(
    `WITH listed AS (
       SELECT * FROM jsonb_to_recordset(CAST(:trainees AS jsonb)) AS l(id uuid, branch_id text)
     ), current_year AS (
       SELECT id FROM public.activity_years
       WHERE is_active AND starts_on<=CAST(:today AS date) AND ends_on>=CAST(:today AS date)
     ), candidates AS (
       SELECT f.trainee_uuid, f.status,
              CASE WHEN f.status IN (:active) THEN 1 ELSE 0 END AS priority,
              COALESCE(f.approved_at,f.updated_at) AS changed_at, f.id,
              'RENEWAL' AS source,
              (SELECT d.id
               FROM public.registration_form_versions v
               JOIN public.registration_form_documents d
                 ON d.form_id=v.form_id AND d.version_id=v.id
               WHERE v.form_id=f.id AND d.kind='REGISTRATION_PDF'
                 AND d.mime_type='application/pdf' AND d.verified_at IS NOT NULL
               ORDER BY v.version_number DESC LIMIT 1) AS pdf_document_id
       FROM public.registration_forms f
       JOIN listed l ON l.id=f.trainee_uuid AND l.branch_id=f.branch_id
       WHERE f.status IN (:active) OR (
         f.status='APPROVED' AND f.activity_year_id IN (SELECT id FROM current_year)
         AND (f.request_type='YEARLY' OR NOT EXISTS (
           SELECT 1 FROM public.branch_registration_periods p
           WHERE p.branch_id=f.branch_id AND p.activity_year_id=f.activity_year_id AND p.status='OPEN'
         ))
       )
       ${applications}
     )
     SELECT DISTINCT ON (trainee_uuid) trainee_uuid AS "traineeUuid", status,
            source, id AS "formId", pdf_document_id AS "documentId"
     FROM candidates ORDER BY trainee_uuid,priority DESC,changed_at DESC,id DESC`,
    {
      replacements: {
        trainees: JSON.stringify(
          trainees.map((t) => ({ id: t.id, branch_id: t.branchId ?? null })),
        ),
        today: new Date().toISOString().slice(0, 10),
        active: ACTIVE_STATUSES,
      },
      type: QueryTypes.SELECT,
      logging: false,
    },
  );
  return new Map(
    rows.map((row) => [
      row.traineeUuid,
      {
        status: row.status,
        pdf:
          row.status === 'APPROVED' && row.documentId
            ? {
                source: row.source,
                formId: row.formId,
                documentId: row.documentId,
              }
            : null,
      },
    ]),
  );
}
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
    if (approved) return null;
    if (getBooleanEnv('PARENT_ADMISSION_SCHEMA_READY', false)) {
      const [application] = await this.db.query(
        `SELECT id FROM public.trainee_applications
        WHERE provisioned_user_id=:traineeUuid AND branch_id=:branchId
        AND approved_activity_year_id=:yearId AND status='APPROVED' LIMIT 1`,
        {
          replacements: { traineeUuid, branchId, yearId: year.id },
          type: QueryTypes.SELECT,
          transaction: t,
          logging: false,
        },
      );
      if (application) return null;
    }
    return period;
  }
  async approvedApplicationData(
    traineeUuid: string,
    branchId: string,
    t: Transaction,
  ) {
    if (!getBooleanEnv('PARENT_ADMISSION_SCHEMA_READY', false)) return null;
    const [row] = await this.db.query<{
      data: import('./registration.validation').RegistrationData;
    }>(
      `SELECT v.form_data AS data FROM public.trainee_applications a JOIN public.trainee_application_versions v ON v.application_id=a.id WHERE a.provisioned_user_id=:traineeUuid AND a.branch_id=:branchId AND a.status='APPROVED' ORDER BY v.version_number DESC LIMIT 1`,
      {
        replacements: { traineeUuid, branchId },
        type: QueryTypes.SELECT,
        transaction: t,
        logging: false,
      },
    );
    return row?.data ?? null;
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
