import {
  RegistrationIntegrationService,
  submittedEvidence,
} from './registration-integration.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  Optional,
  NotFoundException,
} from '@nestjs/common';
import type { Transaction } from 'sequelize';
import { AUTH_ROLES } from '../../constants/auth.constants';
import { AuthorizationService } from '../auth/authorization.service';
import type { AuthUser } from '../auth/authorization.service';
import {
  DECLARATIONS,
  DECLARATION_VERSION,
  TEMPLATE_VERSION,
} from './declarations';
import { RegistrationRepository } from './registration.repository';
import { RegistrationDocumentGenerator } from './registration-document.generator';
import {
  contentHash,
  protectData,
  readData,
  validateDraft,
  retainParentApplicability,
  validateSubmission,
} from './registration.validation';
import type { RegistrationData } from './registration.validation';
import type {
  DraftDto,
  FormListDto,
  OpenPeriodDto,
  RenewDto,
  SubmitDto,
} from './registration.dto';
import type { RegistrationForm } from './entities/registration.entities';
import { getBooleanEnv } from '../../config/env.util';
import { getNationalIdDetails } from '../user/national-id.util';
import { decryptNationalId } from '../user/national-id-encryption.util';
import { VOLUNTEER_PURPOSES, reconcileSignatures, type VolunteerData, type VolunteerPurpose } from '../parent-admission/volunteer.contract';
import { protectVolunteerData, readVolunteerData, validateVolunteerDraft, volunteerContentHash, volunteerScopeHash } from '../parent-admission/volunteer.validation';
import { VOLUNTEER_AGREEMENT_VERSION, VOLUNTEER_DECLARATIONS, VOLUNTEER_LEGAL } from '../parent-admission/volunteer.legal';
import { VOLUNTEER_TEMPLATE_VERSION } from '../parent-admission/volunteer-render.contract';

export const isEditable = (status: string) =>
  ['DRAFT', 'CHANGES_REQUESTED'].includes(status);
export function approvedProfileMapping(data: RegistrationData) {
  // Explicit allowlist. Identity, roles, branch, allergies, notes and medications are excluded.
  const t = data.trainee!;
  return {
    name: `${t.name} ${t.familyName}`.trim(),
    phoneNumber: t.phone,
    address: t.address,
    dateOfBirth: t.dateOfBirth,
    gender: t.gender,
    shirtSize: t.shirtSize,
    customShirtSize: t.shirtSize === 'OTHER' ? t.customShirtSize : null,
    parentName: (data.parent1?.notApplicable ? data.parent2 : data.parent1)
      ?.name,
    ...(t.email ? { email: t.email } : {}),
  };
}
@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    private readonly repo: RegistrationRepository,
    private readonly auth: AuthorizationService,
    private readonly generator: RegistrationDocumentGenerator,
    @Optional() private readonly integration?: RegistrationIntegrationService,
  ) {}
  private async observed<T>(stage: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (!(error instanceof HttpException))
        this.logger.warn(`Unexpected registration service failure: ${stage}`);
      throw error;
    }
  }
  private actor(actor: AuthUser) {
    const id = this.auth.getActorId(actor);
    if (!id) throw new ForbiddenException('Authenticated identity required');
    return id;
  }
  private self(actor: AuthUser) {
    if (!this.auth.hasRole(actor, AUTH_ROLES.TRAINEE.id))
      throw new ForbiddenException('Trainee role required');
    return this.actor(actor);
  }
  private withTrainee<T>(
    id: string,
    work: (
      target: Awaited<ReturnType<RegistrationRepository['lockTrainee']>>,
      t: Transaction,
    ) => Promise<T>,
  ) {
    return this.repo.transaction(async (t) => {
      const target = await this.repo.lockTrainee(id, t);
      if (this.integration?.enabled()) {
        await this.integration.attest(t);
      }
      if (!target.roles.some((r) => r.roleId === AUTH_ROLES.TRAINEE.id))
        throw new ForbiddenException('Target must be a trainee');
      return work(target, t);
    });
  }
  private async ownedForm(
    form: RegistrationForm,
    trainee: string,
    branch: string,
    type: 'TRAINEE' | 'VOLUNTEER' = 'TRAINEE',
  ) {
    if ((form.registrationType ?? 'TRAINEE') !== type)
      throw new ConflictException('Registration type does not match');
    if (form.traineeUuid !== trainee)
      throw new ForbiddenException('Registration ownership denied');
    if (form.branchId !== branch)
      throw new ConflictException(
        'Registration branch changed; administrator resolution required',
      );
  }
  private revision(form: RegistrationForm, revision: number) {
    if (form.draftRevision !== revision)
      throw new ConflictException({
        code: 'DRAFT_REVISION_CONFLICT',
        message: 'Reload the latest draft',
        revision: form.draftRevision,
      });
  }
  private summary(form: RegistrationForm | null) {
    return form
      ? {
          id: form.id,
          registrationType: form.registrationType ?? 'TRAINEE',
          branchId: form.branchId,
          activityYearId: form.activityYearId,
          requestType: form.requestType,
          status: form.status,
          revision: form.draftRevision,
          currentStep: form.currentStep,
          blocksAccess: form.blocksAccess,
          documentStatus: form.documentStatus,
          submittedAt: form.submittedAt,
          approvedAt: form.approvedAt,
        }
      : null;
  }
  private withVolunteer<T>(
    actor: AuthUser,
    work: (target: Awaited<ReturnType<RegistrationRepository['lockTrainee']>>, t: Transaction) => Promise<T>,
  ) {
    if (!this.auth.hasRole(actor, AUTH_ROLES.VOLUNTEER.id))
      throw new ForbiddenException('Volunteer role required');
    return this.repo.transaction(async (t) => {
      const target = await this.repo.lockTrainee(this.actor(actor), t);
      if (!target.roles.some((role) => role.roleId === AUTH_ROLES.VOLUNTEER.id))
        throw new ForbiddenException('Volunteer role required');
      return work(target, t);
    });
  }

  private volunteerSnapshot(form: RegistrationForm, data: VolunteerData) {
    return {
      application: { ...this.summary(form), registrationType: 'VOLUNTEER', feedbackReason: form.feedbackReason },
      data,
      contentHash: volunteerContentHash(data),
      declarations: [...VOLUNTEER_DECLARATIONS],
      declarationVersion: VOLUNTEER_AGREEMENT_VERSION,
      legal: VOLUNTEER_LEGAL,
      integration: this.integration?.enabled() ? 'READY' : 'UNAVAILABLE',
    };
  }

  volunteerRenewal(actor: AuthUser, input?: { revision: number; currentStep: number; data: VolunteerData }) {
    return this.withVolunteer(actor, async ({ user }, t) => {
      let form = await this.repo.active(user.id, t);
      if (!form && !input) {
        const period = await this.repo.annualRequirement(user.id, user.branchId, t);
        if (!period) return null;
        if (!user.nationalIdEncrypted)
          throw new ConflictException('Volunteer account identity is unavailable');
        const identity = getNationalIdDetails(decryptNationalId(user.nationalIdEncrypted));
        if (identity.nationalIdHash !== user.nationalIdHash)
          throw new ConflictException('Volunteer account identity is inconsistent');
        const data = { volunteer: { nationalId: identity.normalizedNationalId } };
        return {
          application: { id: '', branchId: user.branchId, registrationType: 'VOLUNTEER', status: 'DRAFT', revision: 0, currentStep: 1, documentStatus: 'PENDING', feedbackReason: null },
          data, contentHash: volunteerContentHash(data), declarations: [...VOLUNTEER_DECLARATIONS],
          declarationVersion: VOLUNTEER_AGREEMENT_VERSION, legal: VOLUNTEER_LEGAL,
          integration: this.integration?.enabled() ? 'READY' : 'UNAVAILABLE',
        };
      }
      if (!form) {
        const period = await this.repo.annualRequirement(user.id, user.branchId, t);
        if (!period || input!.revision !== 0)
          throw new ConflictException('No current volunteer renewal matches this revision');
        form = await this.repo.createForm({
          traineeUuid: user.id,
          branchId: user.branchId,
          activityYearId: period.activityYearId,
          requestType: 'YEARLY',
          registrationType: 'VOLUNTEER',
          blocksAccess: true,
        }, t);
        await this.repo.history(user.id, 'DRAFT_CREATED', t, { formId: form.id });
      }
      await this.ownedForm(form, user.id, user.branchId, 'VOLUNTEER');
      if (form.registrationType !== 'VOLUNTEER')
        throw new ConflictException('Active registration type does not match volunteer');
      const previous = readVolunteerData(form.draftData);
      if (!input) return this.volunteerSnapshot(form, previous);
      if (!isEditable(form.status)) throw new ConflictException('Submitted content is immutable');
      this.revision(form, input.revision);
      validateVolunteerDraft(input.data);
      const next = structuredClone(input.data);
      if (next.volunteer?.nationalId) {
        const identity = getNationalIdDetails(next.volunteer.nationalId);
        if (identity.nationalIdHash !== user.nationalIdHash)
          throw new BadRequestException('Registration identity does not match the existing account');
        next.volunteer.nationalId = identity.normalizedNationalId;
      }
      if (next.parentConsent?.nationalId)
        next.parentConsent.nationalId = next.parentConsent.nationalId.padStart(9, '0');
      const data = reconcileSignatures(previous, next, VOLUNTEER_AGREEMENT_VERSION);
      for (const purpose of VOLUNTEER_PURPOSES)
        if (data.signatures?.[purpose] && data.signatures[purpose]!.contentHash !== volunteerScopeHash(data, purpose))
          throw new BadRequestException('Signature does not bind its covered data');
      await form.update({
        draftData: protectVolunteerData(data),
        draftRevision: form.draftRevision + 1,
        currentStep: input.currentStep,
      }, { transaction: t });
      return this.volunteerSnapshot(form, data);
    });
  }

  uploadVolunteerRenewal(actor: AuthUser, revision: number, kind: string, bytes: Buffer, purpose?: VolunteerPurpose) {
    return this.withVolunteer(actor, async ({ user }, t) => {
      const form = await this.repo.active(user.id, t);
      if (!form || form.registrationType !== 'VOLUNTEER' || !isEditable(form.status) || !this.integration?.enabled())
        throw new ConflictException('Save an editable volunteer renewal before uploading');
      if (kind !== 'SIGNATURE' && kind !== 'POLICE_CLEARANCE')
        throw new BadRequestException('Invalid volunteer attachment kind');
      await this.ownedForm(form, user.id, user.branchId, 'VOLUNTEER');
      this.revision(form, revision);
      return this.integration.uploadVolunteer(form.id, kind, readVolunteerData(form.draftData), bytes, purpose, t, 'renewal');
    });
  }

  async submitVolunteerRenewal(actor: AuthUser, input: SubmitDto) {
    const result = await this.withVolunteer(actor, async ({ user }, t) => {
      const form = await this.repo.form(input.formId, t);
      await this.ownedForm(form, user.id, user.branchId, 'VOLUNTEER');
      if (form.registrationType !== 'VOLUNTEER')
        throw new ConflictException('Registration is not a volunteer renewal');
      const prior = await this.repo.idempotent(form.id, input.idempotencyKey, t);
      if (prior) {
        if (prior.submittedRevision !== input.revision)
          throw new ConflictException('Idempotency key revision mismatch');
        return { form, version: prior, idempotent: true };
      }
      if (!isEditable(form.status) || !this.integration?.enabled())
        throw new ConflictException('Volunteer renewal is not available for submission');
      this.revision(form, input.revision);
      const data = readVolunteerData(form.draftData);
      if (getNationalIdDetails(data.volunteer?.nationalId ?? '').nationalIdHash !== user.nationalIdHash)
        throw new BadRequestException('Registration identity does not match the existing account');
      const documents = await this.repo.documents(form.id, t);
      await this.integration.verifyVolunteerSigned(form.id, data, documents, t, undefined, 'renewal');
      const versions = await this.repo.versions(form.id, t);
      const refs = Object.values(data.signatures ?? {}).map((signature) => signature.documentId);
      if (new Set(refs).size !== refs.length || versions.some((version) =>
        Object.values(readVolunteerData(version.formData).signatures ?? {}).some((signature) => refs.includes(signature.documentId))))
        throw new ConflictException('Submission requires separate, fresh signatures');
      const versionNumber = (versions[0]?.versionNumber ?? 0) + 1;
      const submittedAt = new Date();
      const version = await this.repo.createVersion({
        formId: form.id,
        registrationType: 'VOLUNTEER',
        versionNumber,
        submittedAt,
        formData: protectVolunteerData(data),
        templateVersion: VOLUNTEER_TEMPLATE_VERSION,
        declarationVersion: VOLUNTEER_AGREEMENT_VERSION,
        declarations: [...VOLUNTEER_DECLARATIONS],
        signingMetadata: { contentHash: volunteerContentHash(data) },
        idempotencyKey: input.idempotencyKey,
        submittedRevision: input.revision,
      }, t);
      await form.update({ status: 'PENDING_REVIEW', submittedAt, documentStatus: 'PENDING', feedbackReason: null }, { transaction: t });
      await this.repo.history(user.id, versionNumber === 1 ? 'SUBMITTED' : 'RESUBMITTED', t,
        { formId: form.id, versionId: version.id }, { versionNumber, documentStatus: 'PENDING' });
      return { form, version, idempotent: false };
    });
    if (result.form.status === 'PENDING_REVIEW') {
      try {
        await this.integration!.generate('renewal', result.form.id, result.version.id, this.actor(actor));
        result.form.documentStatus = 'READY';
      } catch {
        result.form.documentStatus = 'FAILED';
      }
    }
    return { ...this.volunteerSnapshot(result.form, readVolunteerData(result.version.formData)),
      versionId: result.version.id, versionNumber: result.version.versionNumber, idempotent: result.idempotent };
  }

  volunteerStatus(actor: AuthUser) {
    return this.withVolunteer(actor, async ({ user }, t) => {
      const form = await this.repo.active(user.id, t);
      const period = await this.repo.annualRequirement(user.id, user.branchId, t);
      const enabled = getBooleanEnv('VOLUNTEER_ANNUAL_RENEWAL_ENABLED', false);
      return {
        required: enabled && !!(period || form?.blocksAccess),
        accessBlocked: enabled && getBooleanEnv('PARENT_REGISTRATION_BLOCKING_ENABLED', false) &&
          !!(period || form?.blocksAccess),
      };
    });
  }

  status(actor: AuthUser) {
    return this.withTrainee(this.self(actor), async ({ user }, t) => {
      const active = await this.repo.active(user.id, t);
      const annual = await this.repo.annualRequirement(
        user.id,
        user.branchId,
        t,
      );
      const required = Boolean(annual || active?.blocksAccess);
      return {
        form: this.summary(active),
        annualRequired: Boolean(annual),
        annualActivityYearId: annual?.activityYearId ?? null,
        registrationRequired: Boolean(annual || active),
        wouldBlockAccess: required,
        accessBlocked:
          getBooleanEnv('PARENT_REGISTRATION_BLOCKING_ENABLED', false) &&
          required,
        documentIntegration: this.generator.availability(),
      };
    });
  }
  me(actor: AuthUser) {
    return this.withTrainee(this.self(actor), async ({ user }, t) => {
      const form = await this.repo.active(user.id, t);
      const approved = await this.repo.latestApproved(user.id, t);
      if (form) await this.ownedForm(form, user.id, user.branchId);
      // Approved evidence remains available across renewals, without exposing another branch's review data.
      const previous = approved
        ? await this.repo.latestVersion(approved.id, t)
        : null;
      const applicationData =
        !form && !previous && this.integration?.enabled()
          ? await this.repo.approvedApplicationData(user.id, user.branchId, t)
          : null;
      const data = form
        ? readData(form.draftData)
        : previous
          ? readData(previous.formData)
          : applicationData
            ? readData(applicationData)
            : {};
      if (!form) {
        delete data.signatures;
        if (data.medical) delete data.medical.physicianSummaryDocumentId;
      }
      return {
        form: this.summary(form),
        data,
        contentHash: contentHash(data),
        declarations: DECLARATIONS,
        declarationVersion: DECLARATION_VERSION,
        previousApproved: previous
          ? {
              formId: approved!.id,
              versionId: previous.id,
              documents: this.safeDocuments(
                await this.repo.documents(approved!.id, t),
              ),
            }
          : null,
      };
    });
  }
  saveDraft(actor: AuthUser, input: DraftDto) {
    validateDraft(input.data);
    return this.withTrainee(this.self(actor), async ({ user }, t) => {
      let form = await this.repo.active(user.id, t);
      if (!form) {
        if (input.revision !== 0)
          throw new ConflictException('No draft matches this revision');
        const annual = await this.repo.annualRequirement(
          user.id,
          user.branchId,
          t,
        );
        if (!annual)
          throw new ConflictException('No registration is currently requested');
        const approved = await this.repo.latestApproved(user.id, t);
        form = await this.repo.createForm(
          {
            traineeUuid: user.id,
            branchId: user.branchId,
            activityYearId: annual.activityYearId,
            requestType: 'YEARLY',
            blocksAccess: true,
            previousApprovedFormId: approved?.id ?? null,
          },
          t,
        );
        await this.repo.history(user.id, 'DRAFT_CREATED', t, {
          formId: form.id,
        });
      }
      await this.ownedForm(form, user.id, user.branchId);
      if (!isEditable(form.status))
        throw new ConflictException('Submitted content is immutable');
      this.revision(form, input.revision);
      const previous = readData(form.draftData);
      const next = structuredClone(input.data);
      retainParentApplicability(previous, next);
      const hash = contentHash(next);
      // Signing is a separate autosave of the same content hash returned by GET/PATCH.
      // A content change always removes both signatures, even when supplied in this PATCH.
      if (hash !== contentHash(previous)) delete next.signatures;
      for (const signature of Object.values(next.signatures ?? {})) {
        if (
          !signature.documentId ||
          !signature.signedAt ||
          signature.contentHash !== hash
        )
          throw new BadRequestException(
            'Signature must bind the current complete content',
          );
      }
      await form.update(
        {
          draftData: protectData(next),
          draftRevision: form.draftRevision + 1,
          currentStep: input.currentStep,
        },
        { transaction: t },
      );
      return { form: this.summary(form), data: next, contentHash: hash };
    });
  }
  async submit(actor: AuthUser, input: SubmitDto) {
    const result = await this.withTrainee(
      this.self(actor),
      async ({ user }, t) => {
        const form = await this.repo.form(input.formId, t);
        await this.ownedForm(form, user.id, user.branchId);
        const prior = await this.repo.idempotent(
          form.id,
          input.idempotencyKey,
          t,
        );
        if (prior) {
          if (prior.submittedRevision !== input.revision)
            throw new ConflictException(
              'Idempotency key belongs to a different submission revision',
            );
          return {
            form: this.summary(form),
            versionId: prior.id,
            versionNumber: prior.versionNumber,
            idempotent: true,
          };
        }
        if (!isEditable(form.status))
          throw new ConflictException('Registration is not editable');
        this.revision(form, input.revision);
        const data = readData(form.draftData);
        validateSubmission(data);
        const docs = await this.repo.documents(form.id, t);
        const requireDocument = (id: string, kind: string) => {
          const doc = docs.find(
            (d) =>
              d.id === id &&
              d.kind === kind &&
              d.verifiedAt &&
              d.fileSize > 0 &&
              /^[a-f0-9]{64}$/.test(d.checksum),
          );
          if (!doc)
            throw new ConflictException(
              'A verified private attachment is required',
            );
        };
        requireDocument(
          data.medical!.physicianSummaryDocumentId!,
          'PHYSICIAN_SUMMARY',
        );
        if (this.integration?.enabled())
          await this.integration.verifySigned(
            'renewal',
            form.id,
            data,
            docs,
            t,
          );
        const signatures = Object.values(data.signatures!);
        if (
          new Set(signatures.map((s) => s.documentId)).size !==
          signatures.length
        )
          throw new BadRequestException(
            'Each parent needs a separate signature asset',
          );
        const versions = await this.repo.versions(form.id, t);
        for (const signature of signatures) {
          requireDocument(signature.documentId, 'SIGNATURE');
          if (
            versions.some((v) =>
              Object.values(v.formData.signatures ?? {}).some(
                (s) => s.documentId === signature.documentId,
              ),
            )
          )
            throw new ConflictException(
              'Resubmission needs new completed signature assets',
            );
        }
        const versionNumber = (versions[0]?.versionNumber ?? 0) + 1;
        const version = await this.repo.createVersion(
          {
            formId: form.id,
            versionNumber,
            formData: protectData(data),
            templateVersion: TEMPLATE_VERSION,
            declarationVersion: DECLARATION_VERSION,
            declarations: [...DECLARATIONS],
            signingMetadata: {
              contentHash: contentHash(data),
              parent1: data.signatures!.parent1!,
              ...(data.signatures!.parent2
                ? { parent2: data.signatures!.parent2 }
                : {}),
            },
            idempotencyKey: input.idempotencyKey,
            submittedRevision: input.revision,
            submittedAt: new Date(),
          },
          t,
        );
        await form.update(
          {
            status: 'PENDING_REVIEW',
            submittedAt: new Date(),
            documentStatus: 'PENDING',
            feedbackReason: null,
          },
          { transaction: t },
        );
        await this.repo.history(
          user.id,
          versionNumber === 1 ? 'SUBMITTED' : 'RESUBMITTED',
          t,
          { formId: form.id, versionId: version.id },
          { versionNumber, documentStatus: 'PENDING' },
        );
        return {
          form: this.summary(form),
          versionId: version.id,
          versionNumber,
          idempotent: false,
        };
      },
    );
    if (this.integration?.enabled())
      try {
        await this.generator.requestGeneration(result.versionId);
        result.form!.documentStatus = 'READY';
      } catch {
        result.form!.documentStatus = 'FAILED';
      }
    return result;
  }
  upload(
    actor: AuthUser,
    revision: number,
    kind: string,
    bytes: Buffer,
    signer?: 'parent1' | 'parent2',
  ) {
    return this.withTrainee(this.self(actor), async ({ user }, t) => {
      const form = await this.repo.active(user.id, t);
      if (!form || !this.integration?.enabled() || !isEditable(form.status))
        throw new ConflictException('Save an editable draft before uploading');
      await this.ownedForm(form, user.id, user.branchId);
      this.revision(form, revision);
      if (kind !== 'SIGNATURE' && kind !== 'PHYSICIAN_SUMMARY')
        throw new BadRequestException('Invalid attachment kind');
      return this.integration.upload(
        'renewal',
        form.id,
        kind,
        readData(form.draftData),
        bytes,
        signer,
        t,
      );
    });
  }
  async retry(actor: AuthUser) {
    const id = await this.withTrainee(this.self(actor), async ({ user }, t) => {
      const form = await this.repo.active(user.id, t);
      if (!form) throw new NotFoundException();
      return form.id;
    });
    return this.integration!.generate(
      'renewal',
      id,
      undefined,
      this.actor(actor),
    );
  }
  async adminRetry(actor: AuthUser, id: string) {
    await this.adminForm(actor, id, async () => true);
    return this.integration!.generate(
      'renewal',
      id,
      undefined,
      this.actor(actor),
    );
  }
  document(actor: AuthUser, id: string, documentId: string) {
    return this.adminForm(actor, id, async (form, _target, t) => {
      const doc = submittedEvidence(
        await this.observed('document-metadata', () =>
          this.repo.documents(form.id, t),
        ),
        await this.observed('document-versions', () =>
          this.repo.versions(form.id, t),
        ),
      ).find((d) => d.id === documentId);
      if (!doc) throw new NotFoundException();
      return {
        bytes: await this.observed('document-storage-download', () =>
          this.integration!.download(doc, 'renewal', id, t),
        ),
        mimeType: doc.mimeType,
      };
    });
  }
  async feedback(actor: AuthUser) {
    return this.withTrainee(this.self(actor), async ({ user }, t) => {
      const form = await this.repo.active(user.id, t);
      if (form) await this.ownedForm(form, user.id, user.branchId);
      return {
        formId: form?.id ?? null,
        status: form?.status ?? null,
        reason: form?.feedbackReason ?? null,
        requestReason: form?.requestReason ?? null,
      };
    });
  }
  years() {
    return this.repo.years();
  }
  async period(actor: AuthUser, input: OpenPeriodDto) {
    this.auth.assertAdminForBranch(actor, input.branchId);
    const period = await this.repo.period(input.branchId, input.activityYearId);
    return { status: period?.status === 'OPEN' ? 'OPEN' : 'CLOSED' };
  }
  closePeriod(actor: AuthUser, input: OpenPeriodDto) {
    this.auth.assertAdminForBranch(actor, input.branchId);
    return this.repo.transaction((t) =>
      this.repo.closePeriod(input.branchId, input.activityYearId, t),
    );
  }
  openPeriod(actor: AuthUser, input: OpenPeriodDto) {
    this.auth.assertAdminForBranch(actor, input.branchId);
    return this.repo.transaction(async (t) => {
      if (this.integration?.enabled()) await this.integration.attest(t);
      await this.repo.openYear(input.activityYearId, t);
      return this.repo.openPeriod(
        input.branchId,
        input.activityYearId,
        this.actor(actor),
        t,
      );
    });
  }
  list(actor: AuthUser, input: FormListDto) {
    const branchIds = this.auth.resolveAdminBranchScope(actor, input.branchId);
    return this.repo.list({ ...input, branchIds });
  }
  private async adminForm<T>(
    actor: AuthUser,
    formId: string,
    work: (
      form: RegistrationForm,
      target: Awaited<ReturnType<RegistrationRepository['lockTrainee']>>,
      t: Transaction,
    ) => Promise<T>,
  ) {
    // The first read yields only the owner ID; no signed data leaves the service.
    return this.observed('admin-transaction', () =>
      this.repo.transaction(async (t) => {
        const initial = await this.observed('admin-form-reference', () =>
          this.repo.formReference(formId, t),
        );
        this.auth.assertAdminForBranch(actor, initial.branchId);
        const target = await this.observed('admin-trainee-lock', () =>
          this.repo.lockTrainee(initial.traineeUuid, t),
        );
        this.auth.assertAdminForBranch(actor, target.user.branchId);
        const form = await this.observed('admin-form', () =>
          this.repo.form(formId, t),
        );
        const requiredRole = form.registrationType === 'VOLUNTEER' ? AUTH_ROLES.VOLUNTEER.id : AUTH_ROLES.TRAINEE.id;
        if (!target.roles.some((role) => role.roleId === requiredRole))
          throw new ForbiddenException('Target role does not match registration type');
        if (this.integration?.enabled()) {
          await this.observed('admin-attestation', () =>
            this.integration!.attest(t),
          );
        }
        this.auth.assertAdminForBranch(actor, form.branchId);
        // Historical data requires authority over both historical and current branch.
        this.auth.assertAdminForBranch(actor, target.user.branchId);
        return this.observed('admin-work', () => work(form, target, t));
      }),
    );
  }
  private safeDocuments(
    docs: Awaited<ReturnType<RegistrationRepository['documents']>>,
  ) {
    return docs.map((d) => ({
      id: d.id,
      versionId: d.versionId,
      kind: d.kind,
      mimeType: d.mimeType,
      fileSize: d.fileSize,
      checksum: d.checksum,
      verifiedAt: d.verifiedAt,
    }));
  }
  detail(actor: AuthUser, formId: string) {
    return this.adminForm(actor, formId, async (form, { user }, t) => {
      const versions = await this.repo.versions(form.id, t);
      const latest = versions[0];
      const volunteer = form.registrationType === 'VOLUNTEER';
      const proposed = latest && !volunteer ? readData(latest.formData) : null;
      const mapped = proposed ? approvedProfileMapping(proposed) : {};
      const differences = Object.entries(mapped)
        .filter(([key, value]) => user[key] !== value)
        .map(([field, proposedValue]) => ({
          field,
          currentValue: user[field] ?? null,
          proposedValue,
        }));
      return {
        form: this.summary(form),
        requestReason: form.requestReason,
        feedbackReason: form.feedbackReason,
        versions: versions.map((v) => ({
          id: v.id,
          versionNumber: v.versionNumber,
          submittedAt: v.submittedAt,
          data: volunteer ? readVolunteerData(v.formData) : readData(v.formData),
          declarationVersion: v.declarationVersion,
          declarations: v.declarations,
        })),
        differences,
        medicalSynchronization: 'MANUAL_RECONCILIATION_REQUIRED',
        existingAllergies: user.allergies,
        existingMedications: await this.repo.medications(user.id, t),
        documents: this.safeDocuments(
          submittedEvidence(await this.repo.documents(form.id, t), versions),
        ),
      };
    });
  }
  requestChanges(actor: AuthUser, formId: string, reason: string) {
    if (!reason.trim()) throw new BadRequestException('A reason is required');
    return this.adminForm(actor, formId, async (form, _target, t) => {
      if (!['PENDING_REVIEW', 'REJECTED'].includes(form.status))
        throw new ConflictException(
          'Only pending or rejected registrations can be returned',
        );
      const version = await this.repo.latestVersion(form.id, t);
      if (!version) throw new ConflictException('Submitted version missing');
      const draft = structuredClone(version.formData);
      delete draft.signatures;
      await form.update(
        {
          status: 'CHANGES_REQUESTED',
          draftData: draft,
          draftRevision: form.draftRevision + 1,
          feedbackReason: reason.trim(),
          documentStatus: 'PENDING',
        },
        { transaction: t },
      );
      await this.repo.history(this.actor(actor), 'CHANGES_REQUESTED', t, {
        formId: form.id,
        versionId: version.id,
      });
      return this.summary(form);
    });
  }
  reject(actor: AuthUser, formId: string, reason: string) {
    if (!reason.trim()) throw new BadRequestException('A reason is required');
    return this.adminForm(actor, formId, async (form, _target, t) => {
      if (form.status !== 'PENDING_REVIEW')
        throw new ConflictException('Only pending registrations can be rejected');
      const version = await this.repo.latestVersion(form.id, t);
      if (!version) throw new ConflictException('Submitted version missing');
      await form.update(
        { status: 'REJECTED', feedbackReason: reason.trim() },
        { transaction: t },
      );
      await this.repo.history(this.actor(actor), 'REJECTED', t, {
        formId: form.id,
        versionId: version.id,
      });
      return this.summary(form);
    });
  }
  approve(actor: AuthUser, formId: string, expectedVersionId: string) {
    return this.adminForm(actor, formId, async (form, { user }, t) => {
      if (form.status !== 'PENDING_REVIEW' || form.branchId !== user.branchId)
        throw new ConflictException('Registration is not approvable');
      const version = await this.repo.latestVersion(form.id, t);
      if (version && version.id !== expectedVersionId)
        throw new ConflictException(
          'Reload and review the current submitted version',
        );
      const docs = await this.repo.documents(form.id, t);
      const pdf = docs.find(
        (d) =>
          d.kind === 'REGISTRATION_PDF' &&
          d.versionId === version?.id &&
          d.mimeType === 'application/pdf' &&
          d.verifiedAt &&
          d.fileSize > 0 &&
          /^[a-f0-9]{64}$/.test(d.checksum),
      );
      if (!version || !pdf || form.documentStatus !== 'READY')
        throw new ConflictException({
          code: 'REGISTRATION_PDF_PENDING',
          message:
            'Approval requires a generated PDF verified in private storage',
        });
      if (form.registrationType === 'VOLUNTEER') {
        if (!this.integration?.enabled())
          throw new ConflictException('Volunteer evidence integration is unavailable');
        const data = readVolunteerData(version.formData);
        if (version.signingMetadata.contentHash !== volunteerContentHash(data) ||
            pdf.registrationType !== 'VOLUNTEER' ||
            pdf.contentHash !== version.signingMetadata.contentHash ||
            getNationalIdDetails(data.volunteer?.nationalId ?? '').nationalIdHash !== user.nationalIdHash)
          throw new ConflictException('Signed volunteer content does not match the reviewed version');
        await this.integration.verifyVolunteerSigned(form.id, data, docs, t, new Date(version.submittedAt), 'renewal');
        await this.integration.download(pdf, 'renewal', form.id, t);
      } else {
        const data = readData(version.formData);
        validateSubmission(data);
        if (this.integration?.enabled()) {
          await this.integration.verifySigned('renewal', form.id, data, docs, t);
          await this.integration.download(pdf, 'renewal', form.id, t);
        }
        await user.update(approvedProfileMapping(data), { transaction: t });
      }
      await form.update(
        {
          status: 'APPROVED',
          approvedAt: new Date(),
          approvedBy: this.actor(actor),
        },
        { transaction: t },
      );
      await this.repo.history(this.actor(actor), 'APPROVED', t, {
        formId: form.id,
        versionId: version.id,
      });
      return this.summary(form);
    });
  }
  renew(actor: AuthUser, traineeId: string, input: RenewDto) {
    if (!input.reason.trim())
      throw new BadRequestException('A reason is required');
    this.auth.assertAdminForBranch(actor, input.branchId);
    return this.withTrainee(traineeId, async ({ user }, t) => {
      if (input.branchId !== user.branchId)
        throw new ForbiddenException(
          'Renewal branch must match the trainee primary branch',
        );
      this.auth.assertAdminForBranch(actor, user.branchId);
      if (this.integration?.enabled()) await this.integration.attest(t);
      await this.repo.openYear(input.activityYearId, t);
      if (await this.repo.active(user.id, t))
        throw new ConflictException(
          'Trainee already has an active registration',
        );
      const previous = await this.repo.latestApproved(user.id, t);
      const version = previous
        ? await this.repo.latestVersion(previous.id, t)
        : null;
      const source =
        version?.formData ??
        (this.integration?.enabled()
          ? await this.repo.approvedApplicationData(user.id, user.branchId, t)
          : null);
      const draft = source ? structuredClone(source) : {};
      delete draft.signatures;
      // Attachments belong to their source form. A new verified summary is required.
      if (draft.medical) delete draft.medical.physicianSummaryDocumentId;
      const form = await this.repo.createForm(
        {
          traineeUuid: user.id,
          branchId: user.branchId,
          activityYearId: input.activityYearId,
          requestType: 'INDIVIDUAL',
          blocksAccess: input.blocksAccess,
          requestReason: input.reason.trim(),
          previousApprovedFormId: previous?.id ?? null,
          draftData: draft,
        },
        t,
      );
      await this.repo.history(
        this.actor(actor),
        'INDIVIDUAL_RENEWAL_REQUESTED',
        t,
        { formId: form.id },
        { requestType: 'INDIVIDUAL' },
      );
      return this.summary(form);
    });
  }
}
