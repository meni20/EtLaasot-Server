import type { RegistrationType } from './admission.policy';
import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Op, QueryTypes, Transaction, fn, json, where } from 'sequelize';
import User from '../user/entities/user.entity';
import Branch from '../branch/entities/branch.entity';
import {
  ApplicantSession,
  ApplicationEvidence,
  ApplicationEvent,
  ApplicationVersion,
  TraineeApplication,
} from './admission.entities';

@Injectable()
export class AdmissionRepository {
  constructor(@InjectConnection() private readonly db: Sequelize) {}
  transaction<T>(work: (t: Transaction) => Promise<T>) {
    return this.db.transaction(work);
  }
  async currentYear(t: Transaction) {
    const [year] = await this.db.query<{ id: string }>(
      "SELECT id FROM public.activity_years WHERE is_active AND (now() AT TIME ZONE 'UTC')::date BETWEEN starts_on AND ends_on",
      { type: QueryTypes.SELECT, transaction: t, logging: false },
    );
    return year?.id ?? null;
  }
  existingIdentity(nationalIdHash: string, t?: Transaction) {
    return User.findOne({
      where: { nationalIdHash },
      attributes: ['id'],
      paranoid: false,
      transaction: t,
    });
  }
  existingApplication(nationalIdHash: string) {
    return TraineeApplication.findOne({
      where: { nationalIdHash },
      attributes: ['id'],
    });
  }
  async hasPasswordCredentials(nationalIdHash: string) {
    const [row] = await this.db.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM public.application_credentials WHERE national_id_hash=:hash) AS exists',
      {
        replacements: { hash: nationalIdHash },
        type: QueryTypes.SELECT,
        logging: false,
      },
    );
    return row.exists;
  }
  async approvalCredential(
    applicationId: string,
    nationalIdHash: string,
    t: Transaction,
  ) {
    // Session/application locks protect the approval against login and replays.
    // The 039 user trigger serializes identity writers and validates this same hash.
    const [row] = await this.db.query<{
      passwordHash: string;
      loginEmail: string;
    }>(
      `SELECT password_hash AS "passwordHash",login_email AS "loginEmail"
       FROM public.application_credentials WHERE application_id=:applicationId AND national_id_hash=:nationalIdHash`,
      {
        replacements: { applicationId, nationalIdHash },
        type: QueryTypes.SELECT,
        transaction: t,
        logging: false,
      },
    );
    return row;
  }
  async lockApplicantSession(applicationId: string, t: Transaction) {
    await ApplicantSession.findByPk(applicationId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
  }
  async revokeApplicantSessions(applicationId: string, t: Transaction) {
    await ApplicantSession.update(
      { revokedAt: new Date() },
      { where: { applicationId }, transaction: t, logging: false },
    );
  }
  branches() {
    return Branch.findAll({
      where: { isActive: true },
      attributes: ['id', 'name', 'city'],
      order: [['name', 'ASC']],
    });
  }
  branch(id: string | null, t: Transaction) {
    if (!id) return Promise.resolve(null);
    return Branch.findOne({
      where: { id, isActive: true },
      transaction: t,
      lock: t.LOCK.SHARE,
    });
  }
  create(values: Record<string, unknown>, t: Transaction) {
    return TraineeApplication.create(values, { transaction: t });
  }
  createSession(values: Record<string, unknown>, t: Transaction) {
    return ApplicantSession.create(values, { transaction: t });
  }
  async session(hash: string, recovery: boolean, t: Transaction) {
    const row = await ApplicantSession.findOne({
      where: {
        [recovery ? 'recoveryHash' : 'tokenHash']: hash,
        [recovery ? 'recoveryExpiresAt' : 'expiresAt']: { [Op.gt]: new Date() },
        revokedAt: null,
      },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!row)
      throw new UnauthorizedException(
        'Applicant credential is invalid or expired',
      );
    return row;
  }
  async sessionForReissue(applicationId: string, t: Transaction) {
    // Includes revoked/expired rows. Lock credentials before the application,
    // matching recovery/save lock order and serializing concurrent reissues.
    const row = await ApplicantSession.findByPk(applicationId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!row) throw new NotFoundException('Application credentials not found');
    return row;
  }
  async application(id: string, t: Transaction) {
    const row = await TraineeApplication.findByPk(id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!row) throw new NotFoundException('Application not found');
    if (row.deletionRequestedAt)
      throw new ConflictException(
        'Draft deletion is pending; access cannot be restored',
      );
    return row;
  }
  versions(applicationId: string, t: Transaction) {
    return ApplicationVersion.findAll({
      where: { applicationId },
      order: [['versionNumber', 'DESC']],
      transaction: t,
    });
  }
  evidence(applicationId: string, t: Transaction) {
    return ApplicationEvidence.findAll({
      where: { applicationId },
      transaction: t,
    });
  }
  events(applicationId: string, t: Transaction) {
    return ApplicationEvent.findAll({
      where: { applicationId },
      order: [
        ['createdAt', 'DESC'],
        ['id', 'DESC'],
      ],
      transaction: t,
    });
  }
  version(values: Record<string, unknown>, t: Transaction) {
    return ApplicationVersion.create(values, { transaction: t });
  }
  event(
    applicationId: string,
    action: string,
    t: Transaction,
    actorUuid?: string,
    versionId?: string,
    reason?: string,
  ) {
    return ApplicationEvent.create(
      {
        applicationId,
        action,
        actorUuid: actorUuid ?? null,
        versionId: versionId ?? null,
        reason: reason ?? null,
      },
      { transaction: t },
    );
  }
  async list(
    branchIds: string[] | undefined,
    page: number,
    registrationType: RegistrationType | 'ALL' = 'TRAINEE',
    status?: string,
    search?: string,
  ) {
    const result = await TraineeApplication.findAndCountAll({
      where: {
        ...(registrationType === 'ALL' ? {} : { registrationType }),
        ...(status ? { status } : {}),
        ...(search?.trim()
          ? {
              [Op.and]: where(
                fn(
                  'concat',
                  json('draft_data.trainee.name'),
                  ' ',
                  json('draft_data.volunteer.firstName'),
                  ' ',
                  json('draft_data.volunteer.lastName'),
                ),
                { [Op.iLike]: `%${search.trim().replace(/[\\%_]/g, '\\$&')}%` },
              ),
            }
          : {}),
        ...(branchIds ? { branchId: { [Op.in]: branchIds } } : {}),
      },
      attributes: [
        'id',
        'registrationType',
        'branchId',
        'status',
        'draftData',
        'revision',
        'deletionRequestedAt',
        'currentStep',
        'feedbackReason',
        'documentStatus',
        'createdAt',
        'updatedAt',
      ],
      order: [
        ['createdAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: 25,
      offset: (page - 1) * 25,
    });
    const readyApplicationIds = result.rows
      .filter((application) => application.documentStatus === 'READY')
      .map((application) => application.id);
    if (!readyApplicationIds.length)
      return { ...result, pdfDocumentIds: new Map<string, string>() };

    const versions = await ApplicationVersion.findAll({
      where: { applicationId: { [Op.in]: readyApplicationIds } },
      attributes: ['id', 'applicationId', 'versionNumber'],
      order: [
        ['applicationId', 'ASC'],
        ['versionNumber', 'DESC'],
      ],
    });
    const latestVersionIds = new Map<string, string>();
    for (const version of versions)
      if (!latestVersionIds.has(version.applicationId))
        latestVersionIds.set(version.applicationId, version.id);

    const currentVersionIds = [...latestVersionIds.values()];
    if (!currentVersionIds.length)
      return { ...result, pdfDocumentIds: new Map<string, string>() };
    const documents = await ApplicationEvidence.findAll({
      where: {
        applicationId: { [Op.in]: readyApplicationIds },
        versionId: { [Op.in]: currentVersionIds },
        kind: 'REGISTRATION_PDF',
        mimeType: 'application/pdf',
        verifiedAt: { [Op.ne]: null },
        fileSize: { [Op.gt]: 0 },
      },
      attributes: ['id', 'applicationId', 'versionId', 'createdAt'],
      order: [['createdAt', 'DESC']],
    });
    const pdfDocumentIds = new Map<string, string>();
    for (const document of documents)
      if (
        !pdfDocumentIds.has(document.applicationId) &&
        latestVersionIds.get(document.applicationId) === document.versionId
      )
        pdfDocumentIds.set(document.applicationId, document.id);
    return { ...result, pdfDocumentIds };
  }
}
