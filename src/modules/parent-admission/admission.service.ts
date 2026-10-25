import {
  VOLUNTEER_LEGAL,
  VOLUNTEER_AGREEMENT_VERSION,
  VOLUNTEER_SOURCE_SHA256,
} from './volunteer.legal';
import { VOLUNTEER_TEMPLATE_VERSION } from './volunteer-render.contract';
import { volunteerApprovedProfileMapping } from './volunteer-profile.mapping';
import {
  VOLUNTEER_PURPOSES,
  jerusalemDate,
  reconcileSignatures,
  needsParent,
  needsClearance,
  type VolunteerData,
  type VolunteerPurpose,
} from './volunteer.contract';
import {
  validateVolunteerDraft,
  validateVolunteerSubmission,
  readVolunteerData,
  protectVolunteerData,
  volunteerContentHash,
  volunteerScopeHash,
} from './volunteer.validation';
import type { ApplicationFormData } from './admission.policy';
import {
  admissionPolicy,
  registrationType,
  type RegistrationType,
} from './admission.policy';
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
  contentHash,
  protectData,
  readData,
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
  async start(
    identifier: string,
    branchId: string,
    type: RegistrationType = 'TRAINEE',
  ) {
    const policy = admissionPolicy(type);
    policy.assertAvailable('START');
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
            registrationType: policy.type,
            nationalIdHash: identity.nationalIdHash,
            nationalIdEncrypted: encryptNationalId(
              identity.normalizedNationalId,
            ),
            branchId,
            status: 'DRAFT',
            revision: 0,
            currentStep: 1,
            documentStatus: 'PENDING',
            draftData:
              policy.type === 'VOLUNTEER'
                ? protectVolunteerData({
                    volunteer: { nationalId: identity.normalizedNationalId },
                    agreements: { version: VOLUNTEER_AGREEMENT_VERSION },
                  })
                : protectData({
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
      registrationType: registrationType(app.registrationType),
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
  me<T extends RegistrationType = 'TRAINEE'>(token: string) {
    return this.withSession(token, async (app) => {
      const policy = admissionPolicy(app.registrationType);
      policy.assertAvailable('READ');
      if (policy.type === 'VOLUNTEER') {
        const data = readVolunteerData(app.draftData);
        return {
          application: this.summary(app),
          data: data as ApplicationFormData<T>,
          contentHash: volunteerContentHash(data),
          declarations: policy.declarations,
          declarationVersion: policy.declarationVersion,
          legal: VOLUNTEER_LEGAL,
          integration: this.evidence.availability(),
          scopeHashes: Object.fromEntries(
            VOLUNTEER_PURPOSES.map((p) => [p, volunteerScopeHash(data, p)]),
          ),
        };
      }
      return {
        application: this.summary(app),
        data: readData(
          app.draftData as RegistrationData,
        ) as ApplicationFormData<T>,
        contentHash: contentHash(readData(app.draftData as RegistrationData)),
        declarations: policy.declarations,
        declarationVersion: policy.declarationVersion,
        integration: this.evidence.availability(),
      };
    });
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
  save<T extends RegistrationType = 'TRAINEE'>(
    token: string,
    input: {
      revision: number;
      currentStep: number;
      data: ApplicationFormData<T>;
    },
  ) {
    return this.withSession(token, async (app, t) => {
      const policy = admissionPolicy(app.registrationType);
      policy.assertAvailable('SAVE');
      if (policy.type === 'VOLUNTEER') {
        validateVolunteerDraft(input.data);
        if (!isEditable(app.status) || input.revision !== app.revision)
          throw new ConflictException({
            code: 'DRAFT_REVISION_CONFLICT',
            message: 'Reload the application before editing',
          });
        const next = structuredClone(input.data as VolunteerData);
        if (
          getNationalIdDetails(next.volunteer?.nationalId ?? '')
            .nationalIdHash !== app.nationalIdHash
        )
          throw new BadRequestException('Applicant identity cannot be changed');
        next.volunteer!.nationalId = getNationalIdDetails(
          next.volunteer!.nationalId!,
        ).normalizedNationalId;
        if (next.parentConsent?.nationalId)
          next.parentConsent.nationalId =
            next.parentConsent.nationalId.padStart(9, '0');
        const data = reconcileSignatures(
          readVolunteerData(app.draftData),
          next,
          VOLUNTEER_AGREEMENT_VERSION,
        );
        for (const purpose of VOLUNTEER_PURPOSES)
          if (
            data.signatures?.[purpose] &&
            data.signatures[purpose]!.contentHash !==
              volunteerScopeHash(data, purpose)
          )
            throw new BadRequestException(
              'Signature does not bind its covered data',
            );
        await app.update(
          {
            draftData: protectVolunteerData(data),
            revision: app.revision + 1,
            currentStep: input.currentStep,
          },
          { transaction: t },
        );
        return {
          application: this.summary(app),
          data: data as ApplicationFormData<T>,
          contentHash: volunteerContentHash(data),
        };
      }
      policy.validateDraft(input.data);
      if (!isEditable(app.status) || input.revision !== app.revision)
        throw new ConflictException({
          code: 'DRAFT_REVISION_CONFLICT',
          message: 'Reload the application before editing',
        });
      const next = structuredClone(input.data as RegistrationData);
      if (
        getNationalIdDetails(next.trainee?.nationalId ?? '').nationalIdHash !==
        app.nationalIdHash
      )
        throw new BadRequestException('Applicant identity cannot be changed');
      next.trainee!.nationalId = getNationalIdDetails(
        next.trainee!.nationalId!,
      ).normalizedNationalId;
      const previous = readData(app.draftData as RegistrationData),
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
      return {
        application: this.summary(app),
        data: next as ApplicationFormData<T>,
        contentHash: hash,
      };
    });
  }
  private requiredEvidence(
    data: RegistrationData,
    docs: ApplicationEvidence[],
    hash: string,
    type: RegistrationType = 'TRAINEE',
  ) {
    admissionPolicy(type).validateSubmission(data);
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
      const policy = admissionPolicy(app.registrationType);
      policy.assertAvailable('SUBMIT');
      if (policy.type === 'VOLUNTEER')
        return this.submitVolunteer(app, input, t);
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
      const data = readData(app.draftData as RegistrationData),
        hash = contentHash(data);
      const required = this.requiredEvidence(
        data,
        await this.repo.evidence(app.id, t),
        hash,
        policy.type,
      );
      if (
        required.some(
          (d) =>
            d.kind === 'SIGNATURE' &&
            versions.some((v) =>
              Object.values(
                readData(v.formData as RegistrationData).signatures ?? {},
              ).some((s) => s.documentId === d.id),
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
          registrationType: policy.type,
          versionNumber: (versions[0]?.versionNumber ?? 0) + 1,
          submittedRevision: input.revision,
          idempotencyKey: input.idempotencyKey,
          formData: protectData(data),
          contentHash: hash,
          declarations: [...policy.declarations],
          declarationVersion: policy.declarationVersion,
          templateVersion: policy.templateVersion,
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
        if (result.application.registrationType === 'VOLUNTEER')
          await this.integration.generateVolunteer(
            result.application.id,
            result.versionId,
          );
        else
          await this.integration.generate(
            'application',
            result.application.id,
            result.versionId,
          );
        result.application.documentStatus = 'READY';
      } catch {
        result.application.documentStatus = 'FAILED';
      }
    if (result.application.registrationType === 'VOLUNTEER')
      result.application = await this.withSession(token, async (app) =>
        this.summary(app),
      );
    return result;
  }
  private async submitVolunteer(
    app: TraineeApplication,
    input: { revision: number; idempotencyKey: string },
    t: Transaction,
  ) {
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
    if (!isEditable(app.status) || app.revision !== input.revision)
      throw new ConflictException(
        'Application is not editable at this revision',
      );
    if (!(await this.repo.branch(app.branchId, t)))
      throw new ConflictException('Selected branch is inactive');
    const data = readVolunteerData(app.draftData);
    validateVolunteerSubmission(data);
    if (
      getNationalIdDetails(data.volunteer!.nationalId!).nationalIdHash !==
      app.nationalIdHash
    )
      throw new ConflictException('Applicant identity changed');
    const docs = await this.repo.evidence(app.id, t);
    const purposes = VOLUNTEER_PURPOSES.filter(
      (p) => p !== 'PARENTAL_CONSENT' || needsParent(data),
    );
    const refs = [
      ...Object.values(data.signatures ?? {}).map((s) => s.documentId),
      ...(data.policeClearanceDocumentId
        ? [data.policeClearanceDocumentId]
        : []),
    ];
    if (new Set(refs).size !== refs.length)
      throw new ConflictException('Each attachment must be separate');
    for (const p of purposes)
      if (
        versions.some((v) =>
          Object.values(readVolunteerData(v.formData).signatures ?? {}).some(
            (s) => s.documentId === data.signatures![p]!.documentId,
          ),
        )
      )
        throw new ConflictException('Corrections require fresh signatures');
    if (!this.integration?.enabled())
      throw new ConflictException(
        'Private evidence integration is unavailable',
      );
    await this.integration.verifyVolunteerSigned(app.id, data, docs, t);
    const policy = admissionPolicy('VOLUNTEER');
    const version = await this.repo.version(
      {
        applicationId: app.id,
        registrationType: 'VOLUNTEER',
        versionNumber: (versions[0]?.versionNumber ?? 0) + 1,
        submittedRevision: input.revision,
        idempotencyKey: input.idempotencyKey,
        formData: protectVolunteerData(data),
        contentHash: volunteerContentHash(data),
        declarations: [...policy.declarations],
        declarationVersion: policy.declarationVersion,
        templateVersion: policy.templateVersion,
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
    return {
      application: this.summary(app),
      versionId: version.id,
      versionNumber: version.versionNumber,
      idempotent: false,
    };
  }
  upload(
    token: string,
    revision: number,
    kind: string,
    bytes: Buffer,
    signer?: 'parent1' | 'parent2' | VolunteerPurpose,
  ) {
    return this.withSession(token, async (app, t) => {
      const policy = admissionPolicy(app.registrationType);
      policy.assertAvailable('UPLOAD');
      if (
        !this.integration?.enabled() ||
        !isEditable(app.status) ||
        app.revision !== revision
      )
        throw new ConflictException(
          'Reload an editable draft before uploading',
        );
      if (policy.type === 'VOLUNTEER') {
        if (kind !== 'SIGNATURE' && kind !== 'POLICE_CLEARANCE')
          throw new BadRequestException('Invalid volunteer attachment kind');
        return this.integration!.uploadVolunteer(
          app.id,
          kind,
          readVolunteerData(app.draftData),
          bytes,
          signer as VolunteerPurpose,
          t,
        );
      }
      if (
        !policy.evidenceKinds.some((allowed) => allowed === kind) ||
        (kind !== 'PHYSICIAN_SUMMARY' && kind !== 'SIGNATURE')
      )
        throw new BadRequestException('Invalid attachment kind');
      return this.integration.upload(
        'application',
        app.id,
        kind,
        readData(app.draftData as RegistrationData),
        bytes,
        signer as 'parent1' | 'parent2',
        t,
      );
    });
  }
  async retry(token: string) {
    const id = await this.withSession(token, async (app) => {
      admissionPolicy(app.registrationType).assertAvailable('PDF');
      return { id: app.id, type: app.registrationType };
    });
    return id.type === 'VOLUNTEER'
      ? this.integration!.generateVolunteer(id.id)
      : this.integration!.generate('application', id.id);
  }
  async adminRetry(actor: AuthUser, id: string) {
    const type = await this.admin(actor, id, async (app) => {
      admissionPolicy(app.registrationType).assertAvailable('PDF');
      return app.registrationType;
    });
    return type === 'VOLUNTEER'
      ? this.integration!.generateVolunteer(id)
      : this.integration!.generate('application', id);
  }
  async applicantPdf(token: string) {
    const doc = await this.withSession(token, async (app, t) => {
      admissionPolicy(app.registrationType).assertAvailable('PDF');
      const latest = (await this.repo.versions(app.id, t))[0];
      if (!latest) throw new NotFoundException('Submitted PDF is unavailable');
      const pdf = (await this.repo.evidence(app.id, t)).find(
        (d) =>
          d.kind === 'REGISTRATION_PDF' &&
          d.versionId === latest.id &&
          d.registrationType === app.registrationType &&
          d.contentHash === latest.contentHash,
      );
      if (!pdf) throw new NotFoundException('Submitted PDF is unavailable');
      return { pdf, id: app.id };
    });
    return {
      bytes: await this.integration!.download(doc.pdf, 'application', doc.id),
      mimeType: 'application/pdf',
    };
  }
  async document(actor: AuthUser, id: string, documentId: string) {
    const doc = await this.admin(actor, id, async (app, t) => {
      admissionPolicy(app.registrationType).assertAvailable(
        app.registrationType === 'VOLUNTEER' ? 'PDF' : 'REVIEW',
      );
      const found = submittedEvidence(
        await this.repo.evidence(app.id, t),
        await this.repo.versions(app.id, t),
      ).find((d) => d.id === documentId);
      if (
        !found ||
        (app.registrationType === 'VOLUNTEER' &&
          found.registrationType !== 'VOLUNTEER')
      )
        throw new NotFoundException();
      return found;
    });
    return {
      bytes: await this.integration!.download(doc, 'application', id),
      mimeType: doc.mimeType,
    };
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
  async list(
    actor: AuthUser,
    branchId: string | undefined,
    page: number,
    type: RegistrationType | 'ALL' = 'TRAINEE',
    status?: string,
    search?: string,
  ) {
    if (type === 'ALL') admissionPolicy('VOLUNTEER').assertAvailable('REVIEW');
    else admissionPolicy(type).assertAvailable('REVIEW');
    const result = await this.repo.list(
      this.auth.resolveAdminBranchScope(actor, branchId),
      page,
      type,
      status,
      search,
    );
    return {
      count: result.count,
      rows: result.rows.map((app) => ({
        ...this.summary(app),
        applicantName:
          registrationType(app.registrationType) === 'VOLUNTEER'
            ? [
                readVolunteerData(app.draftData as VolunteerData).volunteer
                  ?.firstName,
                readVolunteerData(app.draftData as VolunteerData).volunteer
                  ?.lastName,
              ]
                .filter(Boolean)
                .join(' ') || 'ללא שם'
            : readData(
                app.draftData as RegistrationData,
              ).trainee?.name?.trim() || 'ללא שם',
        pdfDocumentId: result.pdfDocumentIds.get(app.id) ?? null,
      })),
    };
  }
  detail(actor: AuthUser, id: string) {
    return this.admin(actor, id, async (app, t) => {
      admissionPolicy(app.registrationType).assertAvailable('REVIEW');
      return {
        application: this.summary(app),
        branch: await this.repo.branch(app.branchId, t),
        history: (await this.repo.events(app.id, t)).map((e) => ({
          id: e.id,
          action: e.action,
          versionId: e.versionId,
          reason: e.reason,
          createdAt: e.createdAt,
        })),
        versions: (await this.repo.versions(app.id, t)).map((v) => ({
          id: v.id,
          versionNumber: v.versionNumber,
          registrationType: registrationType(v.registrationType),
          data:
            registrationType(v.registrationType) === 'VOLUNTEER'
              ? readVolunteerData(v.formData as VolunteerData)
              : readData(v.formData as RegistrationData),
          submittedAt: v.createdAt,
          contentHash: v.contentHash,
          templateVersion: v.templateVersion,
          declarations: v.declarations,
          ...(v.registrationType === 'VOLUNTEER'
            ? {
                declarationSections: {
                  agreement: v.declarations.slice(
                    0,
                    VOLUNTEER_LEGAL.agreement.length,
                  ),
                  parental: v.declarations[VOLUNTEER_LEGAL.agreement.length],
                  confidentiality: v.declarations.slice(
                    VOLUNTEER_LEGAL.agreement.length + 1,
                  ),
                },
              }
            : {}),
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
          registrationType: d.registrationType,
          signaturePurpose: d.signaturePurpose,
          contentHash: d.contentHash,
          templateVersion: d.templateVersion,
          sourceChecksum: d.sourceChecksum,
        })),
      };
    });
  }
  review(
    actor: AuthUser,
    id: string,
    action: 'CHANGES_REQUESTED' | 'REJECTED',
    reason: string,
    expectedVersionId: string,
  ) {
    if (!reason.trim()) throw new BadRequestException('A reason is required');
    return this.admin(actor, id, async (app, t) => {
      admissionPolicy(app.registrationType).assertAvailable(
        app.registrationType === 'VOLUNTEER' && action === 'CHANGES_REQUESTED'
          ? 'CORRECT'
          : 'REVIEW',
      );
      if (app.status !== 'PENDING_REVIEW')
        throw new ConflictException(
          'Only pending applications can be reviewed',
        );
      const latest = (await this.repo.versions(app.id, t))[0];
      if (!latest || latest.id !== expectedVersionId)
        throw new ConflictException(
          'Submitted version changed; reload before reviewing',
        );
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
      await this.repo.event(
        app.id,
        action,
        t,
        this.auth.getActorId(actor),
        latest.id,
        reason.trim(),
      );
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
      const policy = admissionPolicy(app.registrationType);
      policy.assertAvailable('APPROVE');
      if (policy.type === 'VOLUNTEER')
        return this.approveVolunteer(actor, app, expectedVersionId, t);
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
      const data = readData(latest.formData as RegistrationData),
        docs = await this.repo.evidence(app.id, t);
      if (
        contentHash(data) !== latest.contentHash ||
        registrationType(latest.registrationType) !== policy.type ||
        latest.declarationVersion !== policy.declarationVersion ||
        JSON.stringify(latest.declarations) !==
          JSON.stringify(policy.declarations)
      )
        throw new ConflictException(
          'Submitted evidence integrity could not be verified',
        );
      const required = this.requiredEvidence(
        data,
        docs,
        latest.contentHash,
        policy.type,
      );
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
  private async approveVolunteer(
    actor: AuthUser,
    app: TraineeApplication,
    expectedVersionId: string,
    t: Transaction,
  ) {
    const policy = admissionPolicy('VOLUNTEER'),
      latest = (await this.repo.versions(app.id, t))[0];
    if (!latest || latest.id !== expectedVersionId)
      throw new ConflictException(
        'Submitted version changed; reload before approving',
      );
    if (app.status === 'APPROVED') {
      const user = await this.repo.existingIdentity(app.nationalIdHash, t);
      if (!app.provisionedUserId || user?.id !== app.provisionedUserId)
        throw new ConflictException(
          'Approved account association is inconsistent',
        );
      // Idempotent replay never recovers or regenerates the one-time secret.
      return {
        application: this.summary(app),
        userId: app.provisionedUserId,
        idempotent: true,
      };
    }
    if (app.status !== 'PENDING_REVIEW' || app.documentStatus !== 'READY')
      throw new ConflictException(
        'Current signed PDF is required before approval',
      );
    const data = readVolunteerData(latest.formData as VolunteerData),
      submittedAt = new Date(latest.createdAt);
    validateVolunteerSubmission(data, jerusalemDate(submittedAt));
    if (
      latest.registrationType !== 'VOLUNTEER' ||
      latest.contentHash !== volunteerContentHash(data) ||
      latest.templateVersion !== VOLUNTEER_TEMPLATE_VERSION ||
      latest.declarationVersion !== policy.declarationVersion ||
      JSON.stringify(latest.declarations) !==
        JSON.stringify(policy.declarations)
    )
      throw new ConflictException(
        'Submitted evidence integrity could not be verified',
      );
    const docs = await this.repo.evidence(app.id, t);
    const pdf = docs.find(
      (d) =>
        d.kind === 'REGISTRATION_PDF' &&
        d.registrationType === 'VOLUNTEER' &&
        d.versionId === latest.id &&
        d.contentHash === latest.contentHash &&
        d.templateVersion === VOLUNTEER_TEMPLATE_VERSION &&
        d.sourceChecksum === VOLUNTEER_SOURCE_SHA256 &&
        d.generatedAt &&
        d.verifiedAt &&
        d.mimeType === 'application/pdf' &&
        d.fileSize > 0 &&
        /^[a-f0-9]{64}$/.test(d.checksum),
    );
    if (!pdf)
      throw new ConflictException(
        'Verified PDF for the reviewed version is required',
      );
    if (!this.integration?.enabled())
      throw new ConflictException(
        'Private evidence verification is unavailable',
      );
    await this.integration.verifyVolunteerSigned(
      app.id,
      data,
      docs,
      t,
      submittedAt,
    );
    await this.integration.download(pdf, 'application', app.id, t);
    if (!(await this.repo.branch(app.branchId, t)))
      throw new ConflictException('Selected branch is inactive');
    const identity = getNationalIdDetails(data.volunteer!.nationalId!);
    if (
      identity.nationalIdHash !== app.nationalIdHash ||
      (await this.repo.existingIdentity(app.nationalIdHash, t))
    )
      throw new ConflictException('Identity already exists or changed');
    const result = await this.users.createUserWithRole(
      {
        ...volunteerApprovedProfileMapping(data),
        name: `${data.volunteer!.firstName} ${data.volunteer!.lastName}`.trim(),
        phoneNumber: data.volunteer!.phone!,
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
        reviewedBy: this.auth.getActorId(actor),
        reviewedAt: new Date(),
        feedbackReason: null,
      },
      { transaction: t },
    );
    await this.repo.event(
      app.id,
      'APPROVED',
      t,
      this.auth.getActorId(actor),
      latest.id,
    );
    return {
      application: this.summary(app),
      userId: result.user.id,
      temporaryPassword: result.temporaryPassword,
      temporaryPasswordExpiresAt: result.temporaryPasswordExpiresAt,
      idempotent: false,
    };
  }
}
