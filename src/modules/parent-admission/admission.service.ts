import {
  RegistrationIntegrationService,
  submittedEvidence,
} from '../parent-registration/registration-integration.service';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { Transaction } from 'sequelize';
import { getBooleanEnv } from '../../config/env.util';
import {
  AuthorizationService,
  type AuthUser,
} from '../auth/authorization.service';
import UserService from '../user/user.service';
import { getNationalIdDetails } from '../user/national-id.util';
import { encryptNationalId } from '../user/national-id-encryption.util';
import {
  DECLARATIONS,
  DECLARATION_VERSION,
  TEMPLATE_VERSION,
} from '../parent-registration/declarations';
import {
  contentHash,
  protectData,
  readData,
  validateDraft,
  validateSubmission,
  type RegistrationData,
} from '../parent-registration/registration.validation';
import {
  approvedProfileMapping,
  isEditable,
} from '../parent-registration/registration.service';
import { AdmissionRepository } from './admission.repository';
import { AdmissionEvidenceGateway } from './admission.evidence';
import { applicantToken, credentialHash } from './admission.security';
import type {
  TraineeApplication,
  ApplicationEvidence,
} from './admission.entities';

@Injectable()
export class AdmissionService {
  constructor(
    private readonly repo: AdmissionRepository,
    private readonly auth: AuthorizationService,
    private readonly users: UserService,
    private readonly evidence: AdmissionEvidenceGateway,
    @Optional() private readonly integration?: RegistrationIntegrationService,
  ) {}

  async identify(identifier: string) {
    const hash = getNationalIdDetails(identifier).nationalIdHash;
    const existing = await this.repo.existingIdentity(hash);
    // Product-required discovery discloses only the next step, never account data.
    // Inactive/archived identities also take PASSWORD; they cannot be re-registered.
    return {
      next:
        existing || !getBooleanEnv('APPLICANT_REGISTRATION_ENABLED', false)
          ? 'PASSWORD'
          : 'REGISTER',
    };
  }
  branches() {
    return this.repo.branches();
  }
  private credentials() {
    const token = applicantToken(),
      recoveryCode = applicantToken();
    return {
      token,
      recoveryCode,
      tokenHash: credentialHash('session', token),
      recoveryHash: credentialHash('recovery', recoveryCode),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      recoveryExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    };
  }
  async start(identifier: string, branchId: string) {
    const identity = getNationalIdDetails(identifier);
    if (this.integration?.enabled()) {
      await this.integration.attest();
    }
    try {
      return await this.repo.transaction(async (t) => {
        if (!(await this.repo.branch(branchId, t)))
          throw new BadRequestException('Choose an active branch');
        if (await this.repo.existingIdentity(identity.nationalIdHash, t))
          throw new ConflictException(
            'Unable to start; use login or your saved recovery credential',
          );
        const app = await this.repo.create(
          {
            nationalIdHash: identity.nationalIdHash,
            nationalIdEncrypted: encryptNationalId(
              identity.normalizedNationalId,
            ),
            branchId,
            status: 'DRAFT',
            revision: 0,
            currentStep: 1,
            documentStatus: 'PENDING',
            draftData: protectData({
              trainee: { nationalId: identity.normalizedNationalId },
            }),
          },
          t,
        );
        const { token, recoveryCode, ...stored } = this.credentials();
        await this.repo.createSession({ applicationId: app.id, ...stored }, t);
        await this.repo.event(app.id, 'CREATED', t);
        return {
          application: this.summary(app),
          token,
          recoveryCode,
          expiresAt: stored.expiresAt,
        };
      });
    } catch (e) {
      if ((e as { name?: string })?.name === 'SequelizeUniqueConstraintError')
        throw new ConflictException(
          'Unable to start; use login or your saved recovery credential',
        );
      throw e;
    }
  }
  private summary(app: TraineeApplication) {
    return {
      id: app.id,
      branchId: app.branchId,
      status: app.status,
      revision: app.revision,
      currentStep: app.currentStep,
      documentStatus: app.documentStatus,
      feedbackReason: app.feedbackReason ?? null,
    };
  }
  private withSession<T>(
    token: string,
    work: (app: TraineeApplication, t: Transaction) => Promise<T>,
  ) {
    const hash = credentialHash('session', token);
    return this.repo.transaction(async (t) => {
      const session = await this.repo.session(hash, false, t);
      const app = await this.repo.application(session.applicationId, t);
      if (this.integration?.enabled()) {
        await this.integration.attest(t);
      }
      return work(app, t);
    });
  }
  me(token: string) {
    return this.withSession(token, async (app) => ({
      application: this.summary(app),
      data: readData(app.draftData),
      contentHash: contentHash(readData(app.draftData)),
      declarations: DECLARATIONS,
      declarationVersion: DECLARATION_VERSION,
      integration: this.evidence.availability(),
    }));
  }
  recover(recoveryCode: string) {
    const hash = credentialHash('recovery', recoveryCode);
    return this.repo.transaction(async (t) => {
      const session = await this.repo.session(hash, true, t);
      const app = await this.repo.application(session.applicationId, t);
      const { token, recoveryCode: nextCode, ...stored } = this.credentials();
      stored.recoveryExpiresAt = session.recoveryExpiresAt;
      stored.expiresAt = new Date(
        Math.min(
          stored.expiresAt.getTime(),
          session.recoveryExpiresAt.getTime(),
        ),
      );
      await session.update(stored, { transaction: t });
      await this.repo.event(app.id, 'RECOVERED', t);
      return {
        application: this.summary(app),
        token,
        recoveryCode: nextCode,
        expiresAt: stored.expiresAt,
      };
    });
  }
  revoke(token: string) {
    const hash = credentialHash('session', token);
    return this.repo.transaction(async (t) => {
      const session = await this.repo.session(hash, false, t);
      await session.update({ revokedAt: new Date() }, { transaction: t });
      await this.repo.event(session.applicationId, 'SESSION_REVOKED', t);
      return { ok: true };
    });
  }
  save(
    token: string,
    input: { revision: number; currentStep: number; data: RegistrationData },
  ) {
    validateDraft(input.data);
    return this.withSession(token, async (app, t) => {
      if (!isEditable(app.status) || input.revision !== app.revision)
        throw new ConflictException({
          code: 'DRAFT_REVISION_CONFLICT',
          message: 'Reload the application before editing',
        });
      const next = structuredClone(input.data);
      if (
        getNationalIdDetails(next.trainee?.nationalId ?? '').nationalIdHash !==
        app.nationalIdHash
      )
        throw new BadRequestException('Applicant identity cannot be changed');
      next.trainee!.nationalId = getNationalIdDetails(
        next.trainee!.nationalId!,
      ).normalizedNationalId;
      const previous = readData(app.draftData),
        hash = contentHash(next);
      if (hash !== contentHash(previous)) delete next.signatures;
      for (const signing of Object.values(next.signatures ?? {}))
        if (signing.contentHash !== hash)
          throw new BadRequestException(
            'Signature does not bind current content',
          );
      await app.update(
        {
          draftData: protectData(next),
          revision: app.revision + 1,
          currentStep: input.currentStep,
        },
        { transaction: t },
      );
      return { application: this.summary(app), data: next, contentHash: hash };
    });
  }
  private requiredEvidence(
    data: RegistrationData,
    docs: ApplicationEvidence[],
    hash: string,
  ) {
    validateSubmission(data);
    const ids = [
      data.medical!.physicianSummaryDocumentId!,
      ...Object.values(data.signatures!).map((s) => s.documentId),
    ];
    if (new Set(ids).size !== ids.length)
      throw new ConflictException('Each attachment must be separate');
    return ids.map((id, index) => {
      const doc = docs.find(
        (d) =>
          d.id === id &&
          d.kind === (index === 0 ? 'PHYSICIAN_SUMMARY' : 'SIGNATURE'),
      );
      if (
        !doc ||
        !doc.verifiedAt ||
        (doc.kind === 'SIGNATURE' && doc.contentHash !== hash) ||
        doc.fileSize <= 0 ||
        !/^[a-f0-9]{64}$/.test(doc.checksum)
      )
        throw new ConflictException(
          'Verified current private medical summary and signatures are required',
        );
      return doc;
    });
  }
  async submit(
    token: string,
    input: { revision: number; idempotencyKey: string },
  ) {
    const result = await this.withSession(token, async (app, t) => {
      const versions = await this.repo.versions(app.id, t);
      const prior = versions.find(
        (v) => v.idempotencyKey === input.idempotencyKey,
      );
      if (prior) {
        if (prior.submittedRevision !== input.revision)
          throw new ConflictException('Idempotency key revision mismatch');
        return {
          application: this.summary(app),
          versionId: prior.id,
          versionNumber: prior.versionNumber,
          idempotent: true,
        };
      }
      if (!isEditable(app.status) || input.revision !== app.revision)
        throw new ConflictException(
          'Application is not editable at this revision',
        );
      const data = readData(app.draftData),
        hash = contentHash(data);
      const required = this.requiredEvidence(
        data,
        await this.repo.evidence(app.id, t),
        hash,
      );
      if (
        required.some(
          (d) =>
            d.kind === 'SIGNATURE' &&
            versions.some((v) =>
              Object.values(readData(v.formData).signatures ?? {}).some(
                (s) => s.documentId === d.id,
              ),
            ),
        )
      )
        throw new ConflictException('Corrections require fresh signatures');
      if (this.integration?.enabled())
        await this.integration.verifySigned(
          'application',
          app.id,
          data,
          required,
          t,
        );
      else await this.evidence.verify(required); // Unavailable default prevents submission; no fabricated references.
      const version = await this.repo.version(
        {
          applicationId: app.id,
          versionNumber: (versions[0]?.versionNumber ?? 0) + 1,
          submittedRevision: input.revision,
          idempotencyKey: input.idempotencyKey,
          formData: protectData(data),
          contentHash: hash,
          declarations: [...DECLARATIONS],
          declarationVersion: DECLARATION_VERSION,
          templateVersion: TEMPLATE_VERSION,
        },
        t,
      );
      await app.update(
        {
          status: 'PENDING_REVIEW',
          feedbackReason: null,
          documentStatus: 'PENDING',
        },
        { transaction: t },
      );
      await this.repo.event(app.id, 'SUBMITTED', t);
      // PDF work must be performed by a future durable worker after commit, using
      // this immutable version. Never mark READY from a browser acknowledgement.
      return {
        application: this.summary(app),
        versionId: version.id,
        versionNumber: version.versionNumber,
        idempotent: false,
      };
    });
    if (this.integration?.enabled())
      try {
        await this.integration.generate(
          'application',
          result.application.id,
          result.versionId,
        );
        result.application.documentStatus = 'READY';
      } catch {
        result.application.documentStatus = 'FAILED';
      }
    return result;
  }
  upload(
    token: string,
    revision: number,
    kind: string,
    bytes: Buffer,
    signer?: 'parent1' | 'parent2',
  ) {
    return this.withSession(token, async (app, t) => {
      if (
        !this.integration?.enabled() ||
        !isEditable(app.status) ||
        app.revision !== revision
      )
        throw new ConflictException(
          'Reload an editable draft before uploading',
        );
      if (kind !== 'PHYSICIAN_SUMMARY' && kind !== 'SIGNATURE')
        throw new BadRequestException('Invalid attachment kind');
      return this.integration.upload(
        'application',
        app.id,
        kind,
        readData(app.draftData),
        bytes,
        signer,
        t,
      );
    });
  }
  async retry(token: string) {
    const id = await this.withSession(token, async (app) => app.id);
    return this.integration!.generate('application', id);
  }
  async adminRetry(actor: AuthUser, id: string) {
    await this.admin(actor, id, async () => true);
    return this.integration!.generate('application', id);
  }
  document(actor: AuthUser, id: string, documentId: string) {
    return this.admin(actor, id, async (app, t) => {
      const doc = submittedEvidence(
        await this.repo.evidence(app.id, t),
        await this.repo.versions(app.id, t),
      ).find((d) => d.id === documentId);
      if (!doc) throw new NotFoundException();
      return {
        bytes: await this.integration!.download(doc, 'application', app.id, t),
        mimeType: doc.mimeType,
      };
    });
  }
  private admin<T>(
    actor: AuthUser,
    id: string,
    work: (app: TraineeApplication, t: Transaction) => Promise<T>,
  ) {
    return this.repo.transaction(async (t) => {
      const app = await this.repo.application(id, t);
      this.auth.assertAdminForBranch(actor, app.branchId);
      if (this.integration?.enabled()) {
        await this.integration.attest(t);
      }
      if (!this.auth.getActorId(actor)) throw new NotFoundException();
      return work(app, t);
    });
  }
  async list(actor: AuthUser, branchId: string | undefined, page: number) {
    const result = await this.repo.list(
      this.auth.resolveAdminBranchScope(actor, branchId),
      page,
    );
    return {
      count: result.count,
      rows: result.rows.map((app) => ({
        ...this.summary(app),
        applicantName:
          readData(app.draftData).trainee?.name?.trim() || 'ללא שם',
        pdfDocumentId: result.pdfDocumentIds.get(app.id) ?? null,
      })),
    };
  }
  detail(actor: AuthUser, id: string) {
    return this.admin(actor, id, async (app, t) => ({
      application: this.summary(app),
      versions: (await this.repo.versions(app.id, t)).map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        data: readData(v.formData),
        declarations: v.declarations,
        declarationVersion: v.declarationVersion,
      })),
      integration: this.evidence.availability(),
      documents: submittedEvidence(
        await this.repo.evidence(app.id, t),
        await this.repo.versions(app.id, t),
      ).map((d) => ({
        id: d.id,
        versionId: d.versionId,
        kind: d.kind,
        verifiedAt: d.verifiedAt,
        checksum: d.checksum,
        mimeType: d.mimeType,
        fileSize: d.fileSize,
      })),
    }));
  }
  review(
    actor: AuthUser,
    id: string,
    action: 'CHANGES_REQUESTED' | 'REJECTED',
    reason: string,
  ) {
    if (!reason.trim()) throw new BadRequestException('A reason is required');
    return this.admin(actor, id, async (app, t) => {
      if (app.status !== 'PENDING_REVIEW')
        throw new ConflictException(
          'Only pending applications can be reviewed',
        );
      const latest = (await this.repo.versions(app.id, t))[0];
      if (!latest) throw new ConflictException('Submitted evidence is missing');
      const draft = structuredClone(latest.formData);
      delete draft.signatures;
      await app.update(
        {
          status: action,
          feedbackReason: reason.trim(),
          draftData: draft,
          revision: app.revision + 1,
          documentStatus: 'PENDING',
          reviewedBy: this.auth.getActorId(actor),
          reviewedAt: new Date(),
        },
        { transaction: t },
      );
      await this.repo.event(app.id, action, t, this.auth.getActorId(actor));
      return this.summary(app);
    });
  }
  approve(
    actor: AuthUser,
    id: string,
    expectedVersionId: string,
    identityVerified: boolean,
  ) {
    if (identityVerified !== true)
      throw new BadRequestException(
        'Administrator identity verification must be confirmed',
      );
    return this.admin(actor, id, async (app, t) => {
      if (app.status !== 'PENDING_REVIEW')
        throw new ConflictException('Application is not pending');
      const latest = (await this.repo.versions(app.id, t))[0];
      if (
        !latest ||
        latest.id !== expectedVersionId ||
        app.documentStatus !== 'READY'
      )
        throw new ConflictException(
          'Current signed PDF is required before approval',
        );
      const data = readData(latest.formData),
        docs = await this.repo.evidence(app.id, t);
      if (
        contentHash(data) !== latest.contentHash ||
        latest.declarationVersion !== DECLARATION_VERSION ||
        JSON.stringify(latest.declarations) !== JSON.stringify(DECLARATIONS)
      )
        throw new ConflictException(
          'Submitted evidence integrity could not be verified',
        );
      const required = this.requiredEvidence(data, docs, latest.contentHash);
      const pdf = docs.find(
        (d) =>
          d.kind === 'REGISTRATION_PDF' &&
          d.versionId === latest.id &&
          d.contentHash === latest.contentHash &&
          d.mimeType === 'application/pdf' &&
          d.verifiedAt &&
          d.fileSize > 0 &&
          /^[a-f0-9]{64}$/.test(d.checksum),
      );
      if (!pdf)
        throw new ConflictException(
          'Verified PDF for the reviewed version is required',
        );
      if (this.integration?.enabled()) {
        await this.integration.verifySigned(
          'application',
          app.id,
          data,
          required,
          t,
        );
        await this.integration.download(pdf, 'application', app.id, t);
      } else await this.evidence.verify([...required, pdf]); // Default adapter always fails closed.
      if (!(await this.repo.branch(app.branchId, t)))
        throw new ConflictException('Selected branch is inactive');
      const identity = getNationalIdDetails(data.trainee!.nationalId!);
      if (
        identity.nationalIdHash !== app.nationalIdHash ||
        (await this.repo.existingIdentity(app.nationalIdHash, t))
      )
        throw new ConflictException('Identity already exists or changed');
      const result = await this.users.createTraineeWithRole(
        {
          ...approvedProfileMapping(data),
          phoneNumber: data.trainee!.phone!,
          id: identity.normalizedNationalId,
          branchId: app.branchId,
          isActive: true,
        },
        t,
      );
      await app.update(
        {
          status: 'APPROVED',
          provisionedUserId: result.user.id,
          approvedActivityYearId: await this.repo.currentYear(t),
          reviewedBy: this.auth.getActorId(actor),
          reviewedAt: new Date(),
          feedbackReason: null,
        },
        { transaction: t },
      );
      await this.repo.event(app.id, 'APPROVED', t, this.auth.getActorId(actor));
      // Return once to the authorized administrator only. Never persist/cache/log.
      return {
        application: this.summary(app),
        userId: result.user.id,
        temporaryPassword: result.temporaryPassword,
        temporaryPasswordExpiresAt: result.temporaryPasswordExpiresAt,
      };
    });
  }
}
