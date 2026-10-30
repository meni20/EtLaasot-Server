import {
  hasExpectedRegistrationConfiguration,
  isAllowedDocumentsBaseUrl,
} from './registration-environment';
export {
  isAllowedDocumentsBaseUrl,
  isExpectedDevServiceRoleKey,
  isVerifiedRailwayDevRuntime,
  isVerifiedRailwayProductionRuntime,
} from './registration-environment';
import {
  volunteerRenderRequest,
  VOLUNTEER_TEMPLATE_VERSION,
} from '../parent-admission/volunteer-render.contract';
import {
  VOLUNTEER_DECLARATIONS,
  VOLUNTEER_SOURCE_SHA256,
} from '../parent-admission/volunteer.legal';
import {
  readVolunteerData,
  volunteerContentHash,
} from '../parent-admission/volunteer.validation';
import { VOLUNTEER_AGREEMENT_VERSION } from '../parent-admission/volunteer.legal';
import {
  VOLUNTEER_PURPOSES,
  jerusalemDate,
  needsParent,
  needsClearance,
  type VolunteerData,
  type VolunteerPurpose,
} from '../parent-admission/volunteer.contract';
import {
  volunteerScopeHash,
  validateVolunteerSubmission,
} from '../parent-admission/volunteer.validation';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { QueryTypes, Transaction } from 'sequelize';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { WebSocketLikeConstructor } from '@supabase/realtime-js';
import WebSocket from 'ws';
import { createHash, randomUUID } from 'crypto';
import { isUUID } from 'class-validator';
import { getBooleanEnv, getRequiredEnv } from '../../config/env.util';
import {
  ApplicationEvidence,
  ApplicationVersion,
  ApplicationEvent,
  TraineeApplication,
} from '../parent-admission/admission.entities';
import {
  RegistrationForm,
  RegistrationFormDocument,
  RegistrationFormVersion,
  RegistrationFormHistory,
} from './entities/registration.entities';
import Branch from '../branch/entities/branch.entity';
import {
  contentHash,
  readData,
  validateSubmission,
  type RegistrationData,
} from './registration.validation';
import { registrationRenderRequest } from './registration-render.contract';
import {
  DECLARATIONS,
  DECLARATION_VERSION,
  TEMPLATE_VERSION,
} from './declarations';

type Scope = 'application' | 'renewal';
type Kind =
  | 'PHYSICIAN_SUMMARY'
  | 'SIGNATURE'
  | 'REGISTRATION_PDF'
  | 'POLICE_CLEARANCE';
export interface EvidenceRecord {
  templateVersion?: string | null;
  sourceChecksum?: string | null;
  generatedAt?: Date | null;
  registrationType?: string;
  signaturePurpose?: string | null;
  id: string;
  storageBucket: string;
  storagePath: string;
  mimeType: string;
  fileSize: number;
  checksum: string;
  kind: string;
  versionId: string | null;
  createdAt?: Date;
  verifiedAt: Date;
  contentHash?: string;
}
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const MAX = 10 * 1024 * 1024;
// @types/ws includes a server-side `new WebSocket(null)` overload which makes
// its otherwise-compatible client constructor fail structural assignment.
const NODE_WEBSOCKET_TRANSPORT =
  WebSocket as unknown as WebSocketLikeConstructor;

@Injectable()
export class RegistrationIntegrationService {
  private client?: SupabaseClient;
  private readonly logger = new Logger(RegistrationIntegrationService.name);
  constructor(@InjectConnection() private readonly db: Sequelize) {}
  enabled() {
    return getBooleanEnv('PARENT_REGISTRATION_INTEGRATION_ENABLED', false);
  }
  private fail(stage: string): never {
    this.logger.warn(`Private registration integration unavailable: ${stage}`);
    throw new ServiceUnavailableException(
      'Private registration integration is unavailable',
    );
  }
  private safeFailureDetail(error: unknown) {
    if (!(error instanceof Error)) return 'non-error';
    let message = error.message;
    for (const secret of [
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    ]) {
      if (secret) message = message.replaceAll(secret, '[redacted]');
    }
    message = message
      .replace(
        /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
        '[redacted-jwt]',
      )
      .replace(/https?:\/\/[^\s]+/g, '[redacted-url]')
      .slice(0, 240);
    const code =
      'code' in error && typeof error.code === 'string' ? error.code : 'none';
    return `${error.name}:${code}:${message}`;
  }
  async attest(t?: Transaction) {
    if (
      !this.enabled() ||
      !hasExpectedRegistrationConfiguration() ||
      getBooleanEnv('DB_SYNC', false) ||
      getBooleanEnv('DB_LOGGING', false)
    )
      this.fail('attestation-configuration');
    const identityRows = await this.db
      .query<{ ok: boolean }>(
        `SELECT current_database()='postgres'
          AND current_user='etlaasot_app'
          AND inet_server_port()=5432
          AND to_regclass('public.registration_forms') IS NOT NULL
          AND to_regclass('public.registration_form_documents') IS NOT NULL
          AND to_regclass('public.trainee_applications') IS NOT NULL
          AND to_regclass('public.trainee_application_evidence') IS NOT NULL
          AS ok`,
        { type: QueryTypes.SELECT, transaction: t, logging: false },
      )
      .catch(() => this.fail('attestation-query'));
    const [identity] = identityRows;
    if (!identity?.ok) this.fail('attestation-database');
  }
  async attestDocuments() {
    await this.attest();
    const documentsUrl = getRequiredEnv('REGISTRATION_DOCUMENTS_URL');
    const key = getRequiredEnv('REGISTRATION_DOCUMENTS_API_KEY');
    if (!isAllowedDocumentsBaseUrl(documentsUrl) || !/^[a-f0-9]{64}$/.test(key))
      this.fail('documents-configuration');
    const response = await fetch(
      new URL('/internal/documents/render', documentsUrl),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Api-Key': key,
        },
        body: '{}',
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
      },
    ).catch(() => null);
    // An authenticated empty request must reach Documents validation. A wrong
    // key returns 401, while network/configuration failures do not return 400.
    if (response?.status !== 400) this.fail('documents-connectivity');
  }
  private async bucket(t?: Transaction) {
    await this.attest(t);
    try {
      this.client ??= createClient(
        getRequiredEnv('SUPABASE_URL'),
        getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
        {
          auth: { persistSession: false, autoRefreshToken: false },
          realtime: { transport: NODE_WEBSOCKET_TRANSPORT },
        },
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.warn(
        `Storage client initialization detail: ${this.safeFailureDetail(error)}`,
      );
      return this.fail('storage-client-create');
    }
    let name: string;
    try {
      name = getRequiredEnv('SUPABASE_TRAINEE_DOCUMENTS_BUCKET');
    } catch (error) {
      if (error instanceof HttpException) throw error;
      return this.fail('storage-bucket-configuration');
    }
    if (name !== 'trainee-documents') this.fail('storage-bucket-name');
    const bucketResult = await this.client.storage
      .getBucket(name)
      .catch(() => this.fail('storage-bucket-request'));
    const { data, error } = bucketResult;
    if (
      error ||
      data?.public !== false ||
      !data.allowed_mime_types?.includes('application/pdf')
    )
      this.fail('storage-bucket-metadata');
    return { name, store: this.client.storage.from(name) };
  }
  async inspect(bytes: Buffer, kind: Kind) {
    if (!bytes?.length || bytes.length > MAX)
      throw new BadRequestException('Empty or oversized attachment');
    const { fileTypeFromBuffer } = await import('file-type');
    const detected = await fileTypeFromBuffer(bytes).catch(() => undefined);
    if (
      !detected ||
      !(
        kind === 'SIGNATURE'
          ? ['image/png']
          : kind === 'REGISTRATION_PDF'
            ? ['application/pdf']
            : ['application/pdf', 'image/png', 'image/jpeg']
      ).includes(detected.mime)
    )
      throw new BadRequestException(
        'Attachment content must match its allowed file type',
      );
    if (
      kind === 'SIGNATURE' &&
      (bytes.length > 130000 ||
        bytes.length < 24 ||
        bytes.readUInt32BE(16) > 2000 ||
        bytes.readUInt32BE(20) > 1000 ||
        bytes.readUInt32BE(16) === 0 ||
        bytes.readUInt32BE(20) === 0)
    )
      throw new BadRequestException(
        'Signature PNG dimensions or size are invalid',
      );
    if (
      detected.mime === 'application/pdf' &&
      (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) ||
        !bytes.subarray(-2048).includes(Buffer.from('%%EOF')))
    )
      throw new BadRequestException('Invalid PDF envelope');
    return {
      mimeType: detected.mime,
      extension:
        detected.mime === 'image/jpeg'
          ? 'jpg'
          : detected.mime === 'image/png'
            ? 'png'
            : 'pdf',
    };
  }
  private assertPath(doc: EvidenceRecord, scope?: Scope, ownerId?: string) {
    const parts = doc.storagePath.split('/');
    if (
      doc.registrationType === 'VOLUNTEER' &&
      doc.kind === 'REGISTRATION_PDF' &&
      (doc.templateVersion !== VOLUNTEER_TEMPLATE_VERSION ||
        doc.sourceChecksum !== VOLUNTEER_SOURCE_SHA256 ||
        !doc.generatedAt ||
        doc.contentHash !== parts[3] ||
        !doc.versionId)
    )
      this.fail('volunteer-pdf-metadata');
    if (
      doc.storageBucket !== 'trainee-documents' ||
      parts.length !== 6 ||
      parts[0] !== 'registration' ||
      !['application', 'renewal'].includes(parts[1]) ||
      !isUUID(parts[2], '4') ||
      !/^[a-f0-9]{64}$/.test(parts[3]) ||
      ![
        'medical',
        'parent1',
        'parent2',
        'pdf',
        ...VOLUNTEER_PURPOSES,
        'police',
      ].includes(parts[4]) ||
      !/^[-a-f0-9]{36}\.(pdf|png|jpg)$/.test(parts[5]) ||
      (scope && parts[1] !== scope) ||
      (ownerId && parts[2] !== ownerId)
    )
      this.fail('storage-path');
  }
  async download(
    doc: EvidenceRecord,
    scope?: Scope,
    ownerId?: string,
    t?: Transaction,
  ) {
    this.assertPath(doc, scope, ownerId);
    const { store } = await this.bucket(t);
    const downloadResult = await store
      .download(doc.storagePath)
      .catch(() => this.fail('storage-download-request'));
    const { data, error } = downloadResult;
    if (error || !data || data.size > MAX) this.fail('storage-download');
    const bytes = await data
      .arrayBuffer()
      .then((value) => Buffer.from(value))
      .catch(() => this.fail('storage-response-body'));
    const info = await this.inspect(bytes, doc.kind as Kind).catch((error) => {
      if (error instanceof HttpException) throw error;
      return this.fail('storage-inspection');
    });
    if (
      bytes.length !== doc.fileSize ||
      sha(bytes) !== doc.checksum ||
      info.mimeType !== doc.mimeType
    )
      this.fail('storage-integrity');
    return bytes;
  }
  async verify(objects: EvidenceRecord[]) {
    for (const doc of objects) await this.download(doc);
  }
  async verifySigned(
    scope: Scope,
    id: string,
    data: RegistrationData,
    docs: EvidenceRecord[],
    t?: Transaction,
  ) {
    validateSubmission(data);
    const hash = contentHash(data);
    const medical = docs.find(
      (d) =>
        d.id === data.medical!.physicianSummaryDocumentId &&
        d.kind === 'PHYSICIAN_SUMMARY',
    );
    if (!medical)
      throw new ConflictException('Private medical evidence is missing');
    await this.download(medical, scope, id, t);
    for (const key of ['parent1', 'parent2'] as const) {
      const signing = data.signatures?.[key];
      if (!signing) continue;
      const doc = docs.find(
        (d) => d.id === signing.documentId && d.kind === 'SIGNATURE',
      );
      if (
        !doc ||
        doc.storagePath.split('/')[3] !== hash ||
        doc.storagePath.split('/')[4] !== key ||
        (!doc.createdAt ? '' : new Date(doc.createdAt).toISOString()) !==
          signing.signedAt
      )
        throw new ConflictException(
          'Signature does not belong to this signer, content and signing date',
        );
      await this.download(doc, scope, id, t);
    }
  }
  async upload(
    scope: Scope,
    id: string,
    kind: 'PHYSICIAN_SUMMARY' | 'SIGNATURE',
    data: RegistrationData,
    bytes: Buffer,
    signer?: 'parent1' | 'parent2',
    t?: Transaction,
  ) {
    await this.attest(t);
    if (
      !isUUID(id, '4') ||
      (kind === 'SIGNATURE' && !['parent1', 'parent2'].includes(signer!))
    )
      throw new BadRequestException('Invalid attachment owner or signer');
    if (
      kind === 'SIGNATURE' &&
      (!data[signer!]?.name || !data[signer!]?.nationalId)
    )
      throw new BadRequestException('Save the signing parent identity first');
    const info = await this.inspect(bytes, kind);
    if (kind === 'PHYSICIAN_SUMMARY' && info.mimeType !== 'application/pdf') {
      const [history] = await this.db.query<{ ready: boolean }>(
        "SELECT EXISTS(SELECT 1 FROM public.schema_migrations WHERE filename='032_registration_medical_image_mime.sql') AS ready",
        { type: QueryTypes.SELECT, transaction: t },
      );
      if (!history?.ready)
        throw new ServiceUnavailableException(
          'Medical image uploads require approved migration 032; PDF uploads remain available',
        );
    }
    const hash = contentHash(data),
      docId = randomUUID(),
      createdAt = new Date();
    const storagePath = `registration/${scope}/${id}/${hash}/${kind === 'SIGNATURE' ? signer : 'medical'}/${docId}.${info.extension}`;
    const { name, store } = await this.bucket(t);
    const { error } = await store.upload(storagePath, bytes, {
      contentType: info.mimeType,
      upsert: false,
      cacheControl: '0',
    });
    if (error) this.fail('storage-upload');
    const values = {
      id: docId,
      kind,
      storageBucket: name,
      storagePath,
      mimeType: info.mimeType,
      fileSize: bytes.length,
      checksum: sha(bytes),
      verifiedAt: createdAt,
      createdAt,
      versionId: null,
    };
    // On ambiguous DB commit leave an unreferenced private object; never remove
    // anything that might be referenced by an immutable submitted version.
    const doc =
      scope === 'application'
        ? await ApplicationEvidence.create(
            { ...values, applicationId: id, contentHash: hash },
            { transaction: t },
          )
        : await RegistrationFormDocument.create(
            { ...values, formId: id },
            { transaction: t },
          );
    await this.download(doc, scope, id, t);
    return {
      documentId: docId,
      contentHash: hash,
      signedAt: createdAt.toISOString(),
    };
  }
  async uploadVolunteer(
    id: string,
    kind: 'SIGNATURE' | 'POLICE_CLEARANCE',
    data: VolunteerData,
    bytes: Buffer,
    purpose: VolunteerPurpose | undefined,
    t?: Transaction,
  ) {
    await this.attest(t);
    if (!isUUID(id, '4'))
      throw new BadRequestException('Invalid attachment owner');
    if (kind === 'SIGNATURE') {
      if (!purpose || !VOLUNTEER_PURPOSES.includes(purpose))
        throw new BadRequestException('Invalid signature purpose');
      const signer =
        purpose === 'PARENTAL_CONSENT' ? data.parentConsent : data.volunteer;
      if (
        !signer?.nationalId ||
        (purpose === 'PARENTAL_CONSENT'
          ? !data.parentConsent?.name
          : !data.volunteer?.firstName || !data.volunteer?.lastName)
      )
        throw new BadRequestException('Save signer identity before signing');
      if (
        purpose === 'PARENTAL_CONSENT' &&
        (!needsParent(data) || data.parentConsent?.acknowledged !== true)
      )
        throw new BadRequestException(
          'Parental consent is not applicable or acknowledged',
        );
      if (
        (purpose === 'VOLUNTEER_AGREEMENT' &&
          data.agreements?.volunteer !== true) ||
        (purpose === 'CONFIDENTIALITY' &&
          data.agreements?.confidentiality !== true) ||
        data.agreements?.version !== VOLUNTEER_AGREEMENT_VERSION
      )
        throw new BadRequestException(
          'Acknowledge the current agreement before signing',
        );
    } else if (!needsClearance(data))
      throw new BadRequestException('Police clearance is not applicable');
    const info = await this.inspect(bytes, kind);
    const hash =
      kind === 'SIGNATURE' ? volunteerScopeHash(data, purpose!) : sha(bytes);
    const createdAt = new Date(),
      docId = randomUUID();
    const storagePath = `registration/application/${id}/${hash}/${kind === 'SIGNATURE' ? purpose : 'police'}/${docId}.${info.extension}`;
    const { name, store } = await this.bucket(t);
    const { error } = await store.upload(storagePath, bytes, {
      contentType: info.mimeType,
      upsert: false,
      cacheControl: '0',
    });
    if (error) this.fail('volunteer-upload');
    const doc = await ApplicationEvidence.create(
      {
        id: docId,
        applicationId: id,
        registrationType: 'VOLUNTEER',
        signaturePurpose: kind === 'SIGNATURE' ? purpose : null,
        kind,
        storageBucket: name,
        storagePath,
        mimeType: info.mimeType,
        fileSize: bytes.length,
        checksum: sha(bytes),
        contentHash: hash,
        verifiedAt: createdAt,
        createdAt,
        versionId: null,
      },
      { transaction: t },
    );
    await this.download(doc, 'application', id, t);
    return {
      documentId: docId,
      contentHash: hash,
      signedAt: createdAt.toISOString(),
      agreementVersion: VOLUNTEER_AGREEMENT_VERSION,
      validation: 'CONTENT_ONLY',
    };
  }
  async verifyVolunteerSigned(
    id: string,
    data: VolunteerData,
    docs: EvidenceRecord[],
    t?: Transaction,
    asOf?: Date,
  ) {
    const today = jerusalemDate(asOf ?? new Date());
    validateVolunteerSubmission(data, today);
    for (const purpose of VOLUNTEER_PURPOSES) {
      if (
        purpose === 'PARENTAL_CONSENT' &&
        !needsParent(data, today) &&
        !data.signatures?.[purpose]
      )
        continue;
      const s = data.signatures![purpose]!;
      const doc = docs.find(
        (d) =>
          d.id === s.documentId &&
          d.kind === 'SIGNATURE' &&
          d.registrationType === 'VOLUNTEER' &&
          d.signaturePurpose === purpose,
      );
      if (
        !doc ||
        !doc.verifiedAt ||
        doc.contentHash !== volunteerScopeHash(data, purpose) ||
        doc.storagePath.split('/')[3] !== s.contentHash ||
        doc.storagePath.split('/')[4] !== purpose ||
        !doc.createdAt ||
        new Date(doc.createdAt).toISOString() !== s.signedAt
      )
        throw new ConflictException(
          'Signature owner, purpose, date or covered content mismatch',
        );
      await this.download(doc, 'application', id, t);
    }
    if (needsClearance(data, today) || data.policeClearanceDocumentId) {
      const doc = docs.find(
        (d) =>
          d.id === data.policeClearanceDocumentId &&
          d.kind === 'POLICE_CLEARANCE' &&
          d.registrationType === 'VOLUNTEER',
      );
      if (!doc || !doc.verifiedAt || doc.storagePath.split('/')[4] !== 'police')
        throw new ConflictException('Private police clearance is required');
      await this.download(doc, 'application', id, t);
    }
  }
  // Snapshot and attach use short DB transactions. Rendering, evidence downloads
  // and Storage read-back run outside row locks. A unique PDF/version index is
  // the final arbiter across concurrent requests/processes.
  async generateVolunteer(id: string, expectedVersionId?: string) {
    await this.attest();
    let versionId: string | undefined;
    let verifyingExistingPdf = false;
    try {
      const snapshot = await this.db.transaction(async (t) => {
        const app = await TraineeApplication.findByPk(id, {
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        if (!app || app.registrationType !== 'VOLUNTEER')
          throw new ConflictException('Volunteer application not found');
        const version = await ApplicationVersion.findOne({
          where: {
            applicationId: id,
            ...(expectedVersionId ? { id: expectedVersionId } : {}),
          },
          order: [['versionNumber', 'DESC']],
          transaction: t,
        });
        if (!version || version.registrationType !== 'VOLUNTEER')
          throw new ConflictException('Submitted volunteer version is missing');
        versionId = version.id;
        const branch = await Branch.findByPk(app.branchId, { transaction: t });
        if (!branch)
          throw new ConflictException('Registration branch is missing');
        return {
          branchId: app.branchId,
          branch: branch.name,
          version,
          docs: await ApplicationEvidence.findAll({
            where: { applicationId: id },
            transaction: t,
          }),
        };
      });
      const v = snapshot.version,
        data = readVolunteerData(v.formData),
        submittedAt = new Date(v.createdAt).toISOString();
      verifyingExistingPdf = snapshot.docs.some(
        (d) =>
          d.kind === 'REGISTRATION_PDF' &&
          d.versionId === v.id &&
          d.registrationType === 'VOLUNTEER',
      );
      if (
        v.contentHash !== volunteerContentHash(data) ||
        v.declarationVersion !== VOLUNTEER_AGREEMENT_VERSION ||
        JSON.stringify(v.declarations) !==
          JSON.stringify(VOLUNTEER_DECLARATIONS) ||
        ![
          VOLUNTEER_TEMPLATE_VERSION,
          'volunteer-registration-v1-deferred',
        ].includes(v.templateVersion)
      )
        throw new ConflictException(
          'Immutable volunteer version integrity mismatch',
        );
      await this.verifyVolunteerSigned(
        id,
        data,
        snapshot.docs,
        undefined,
        new Date(submittedAt),
      );
      let candidate = snapshot.docs.find(
        (d) =>
          d.kind === 'REGISTRATION_PDF' &&
          d.versionId === v.id &&
          d.registrationType === 'VOLUNTEER',
      );
      if (candidate) await this.download(candidate, 'application', id);
      else {
        const images: Partial<Record<VolunteerPurpose, string>> = {};
        for (const purpose of VOLUNTEER_PURPOSES) {
          if (
            purpose === 'PARENTAL_CONSENT' &&
            !needsParent(data, jerusalemDate(new Date(submittedAt)))
          )
            continue;
          const doc = snapshot.docs.find(
            (d) => d.id === data.signatures![purpose]!.documentId,
          )!;
          images[purpose] =
            'data:image/png;base64,' +
            (await this.download(doc, 'application', id)).toString('base64');
        }
        const payload = volunteerRenderRequest(
          data,
          {
            reference: v.id,
            applicationId: id,
            branch: snapshot.branch,
            submittedAt,
          },
          images,
          v.declarations,
        );
        const url = getRequiredEnv('REGISTRATION_DOCUMENTS_URL'),
          key = getRequiredEnv('REGISTRATION_DOCUMENTS_API_KEY');
        if (!isAllowedDocumentsBaseUrl(url) || !/^[a-f0-9]{64}$/.test(key))
          this.fail('documents-configuration');
        const response = await fetch(
          new URL('/internal/documents/render', url),
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Internal-Api-Key': key,
            },
            body: JSON.stringify(payload),
            redirect: 'error',
            signal: AbortSignal.timeout(60000),
          },
        );
        if (
          !response.ok ||
          !response.headers.get('content-type')?.startsWith('application/pdf')
        )
          this.fail('volunteer-render');
        const chunks: Buffer[] = [];
        let size = 0;
        const reader = response.body?.getReader();
        if (!reader) this.fail('volunteer-render-body');
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > MAX) {
            await reader.cancel();
            this.fail('volunteer-pdf-size');
          }
          chunks.push(Buffer.from(part.value));
        }
        const bytes = Buffer.concat(chunks);
        await this.inspect(bytes, 'REGISTRATION_PDF');
        const docId = randomUUID(),
          now = new Date(),
          storagePath = `registration/application/${id}/${v.contentHash}/pdf/${docId}.pdf`;
        const { name, store } = await this.bucket();
        const uploaded = await store.upload(storagePath, bytes, {
          contentType: 'application/pdf',
          upsert: false,
          cacheControl: '0',
        });
        if (uploaded.error) this.fail('volunteer-pdf-upload');
        candidate = ApplicationEvidence.build({
          id: docId,
          applicationId: id,
          registrationType: 'VOLUNTEER',
          kind: 'REGISTRATION_PDF',
          versionId: v.id,
          contentHash: v.contentHash,
          storageBucket: name,
          storagePath,
          mimeType: 'application/pdf',
          fileSize: bytes.length,
          checksum: sha(bytes),
          verifiedAt: now,
          templateVersion: VOLUNTEER_TEMPLATE_VERSION,
          sourceChecksum: VOLUNTEER_SOURCE_SHA256,
          generatedAt: now,
        });
        await this.download(candidate, 'application', id);
      }
      const verified = candidate;
      const result = await this.db.transaction(async (t) => {
        const app = await TraineeApplication.findByPk(id, {
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        if (
          !app ||
          app.registrationType !== 'VOLUNTEER' ||
          app.branchId !== snapshot.branchId
        )
          throw new ConflictException('Application scope changed');
        let pdf = await ApplicationEvidence.findOne({
          where: {
            applicationId: id,
            versionId: v.id,
            kind: 'REGISTRATION_PDF',
          },
          transaction: t,
        });
        if (!pdf) {
          pdf = await ApplicationEvidence.create(
            verified.get({ plain: true }),
            { transaction: t },
          );
          await ApplicationEvent.create(
            {
              applicationId: id,
              versionId: v.id,
              action: 'PDF_GENERATED',
              actorUuid: null,
            },
            { transaction: t },
          );
        }
        const latest = await ApplicationVersion.findOne({
          where: { applicationId: id },
          order: [['versionNumber', 'DESC']],
          transaction: t,
        });
        const current = latest?.id === v.id && app.status === 'PENDING_REVIEW';
        if (current)
          await app.update({ documentStatus: 'READY' }, { transaction: t });
        return {
          status: 'READY' as const,
          versionId: v.id,
          current,
          documentId: pdf.id,
        };
      });
      // A race may leave an unused private object. Do not delete on an ambiguous
      // commit; existing immutable references always take precedence over cleanup.
      return result;
    } catch (error) {
      this.logger.warn('Volunteer PDF generation failed');
      if (versionId)
        await this.db.transaction(async (t) => {
          const app = await TraineeApplication.findByPk(id, {
            transaction: t,
            lock: t.LOCK.UPDATE,
          });
          if (!app || app.registrationType !== 'VOLUNTEER') return;
          const latest = await ApplicationVersion.findOne({
            where: { applicationId: id },
            order: [['versionNumber', 'DESC']],
            transaction: t,
          });
          if (
            latest?.id === versionId &&
            app.status === 'PENDING_REVIEW' &&
            (app.documentStatus !== 'READY' || verifyingExistingPdf)
          )
            await app.update({ documentStatus: 'FAILED' }, { transaction: t });
          await ApplicationEvent.create(
            {
              applicationId: id,
              versionId,
              action: 'PDF_FAILED',
              actorUuid: null,
            },
            { transaction: t },
          );
        });
      if (error instanceof ConflictException) throw error;
      this.fail('volunteer-pdf-generation');
    }
  }
  async generate(
    scope: Scope,
    id: string,
    expectedVersionId?: string,
    actorId?: string,
  ) {
    await this.attest();
    let attemptedVersionId: string | undefined;
    let stage = 'SUBMISSION_LOOKUP';
    let documentsStatus: number | undefined;
    let invalidFields: string[] = [];
    try {
      return await this.db.transaction(async (t) => {
        const owner =
          scope === 'application'
            ? await TraineeApplication.findByPk(id, {
                transaction: t,
                lock: t.LOCK.UPDATE,
              })
            : await RegistrationForm.findByPk(id, {
                transaction: t,
                lock: t.LOCK.UPDATE,
              });
        if (!owner) throw new ConflictException('Registration not found');
        if (
          scope === 'application' &&
          (owner as TraineeApplication).registrationType === 'VOLUNTEER'
        )
          throw new ConflictException(
            'Volunteer PDF generation is not implemented',
          );
        const version =
          scope === 'application'
            ? await ApplicationVersion.findOne({
                where: { applicationId: id },
                order: [['versionNumber', 'DESC']],
                transaction: t,
              })
            : await RegistrationFormVersion.findOne({
                where: { formId: id },
                order: [['versionNumber', 'DESC']],
                transaction: t,
              });
        if (!version || (expectedVersionId && version.id !== expectedVersionId))
          throw new ConflictException('Submitted version changed');
        attemptedVersionId = version.id;
        const docs: EvidenceRecord[] =
          scope === 'application'
            ? await ApplicationEvidence.findAll({
                where: { applicationId: id },
                transaction: t,
              })
            : await RegistrationFormDocument.findAll({
                where: { formId: id },
                transaction: t,
              });
        const prior = docs.find(
          (d) => d.kind === 'REGISTRATION_PDF' && d.versionId === version.id,
        );
        if (prior) {
          await this.download(prior, scope, id, t);
          if (owner.status === 'PENDING_REVIEW')
            await owner.update({ documentStatus: 'READY' }, { transaction: t });
          return { status: 'READY' as const, versionId: version.id };
        }
        if (owner.status !== 'PENDING_REVIEW')
          throw new ConflictException(
            'Only a submitted version can generate a PDF',
          );
        const data = readData(version.formData as RegistrationData);
        if (
          version.templateVersion !== TEMPLATE_VERSION ||
          version.declarationVersion !== DECLARATION_VERSION ||
          JSON.stringify(version.declarations) !== JSON.stringify(DECLARATIONS)
        )
          throw new ConflictException('Unsupported immutable document version');
        if (
          scope === 'application' &&
          (version as ApplicationVersion).contentHash !== contentHash(data)
        )
          throw new ConflictException('Submitted content changed');
        stage = 'EVIDENCE_VERIFICATION';
        await this.verifySigned(scope, id, data, docs, t);
        const images: { parent1: string; parent2?: string } = { parent1: '' };
        for (const key of ['parent1', 'parent2'] as const) {
          const s = data.signatures?.[key];
          if (s)
            images[key] =
              'data:image/png;base64,' +
              (
                await this.download(
                  docs.find((d) => d.id === s.documentId)!,
                  scope,
                  id,
                  t,
                )
              ).toString('base64');
        }
        const branch = await Branch.findByPk(owner.branchId, {
          transaction: t,
        });
        const [year] = await this.db.query<{ name: string }>(
          scope === 'renewal'
            ? 'SELECT name FROM public.activity_years WHERE id=:year'
            : 'SELECT name FROM public.activity_years WHERE is_active LIMIT 1',
          {
            replacements: {
              year: (owner as RegistrationForm).activityYearId ?? null,
            },
            type: QueryTypes.SELECT,
            transaction: t,
          },
        );
        const documentsUrl = getRequiredEnv('REGISTRATION_DOCUMENTS_URL');
        if (!isAllowedDocumentsBaseUrl(documentsUrl))
          this.fail('documents-configuration');
        const url = new URL(documentsUrl);
        const key = getRequiredEnv('REGISTRATION_DOCUMENTS_API_KEY');
        if (!/^[a-f0-9]{64}$/.test(key)) this.fail('documents-authentication');
        const payload = registrationRenderRequest(
          data,
          {
            reference: version.id,
            branch: branch!.name,
            year: year?.name ?? 'לא צוינה שנת פעילות',
            date: new Date().toISOString().slice(0, 10),
          },
          images,
        );
        stage = 'DOCUMENTS_REQUEST';
        const response = await fetch(
          new URL('/internal/documents/render', url),
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Internal-Api-Key': key,
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(60000),
            redirect: 'error',
          },
        );
        documentsStatus = response.status;
        if (
          !response.ok ||
          !response.headers.get('content-type')?.startsWith('application/pdf')
        ) {
          if (response.status === 400) {
            const detail = await response.json().catch(() => null);
            // Only schema field paths are safe to record. Never log a request,
            // response body, phone, identity, signature, key or provider error.
            invalidFields = safeRenderFields(detail?.fields);
          }
          this.fail('storage-upload-verification');
        }
        stage = 'PDF_VALIDATION';
        const bytes = Buffer.from(await response.arrayBuffer());
        await this.inspect(bytes, 'REGISTRATION_PDF');
        stage = 'STORAGE_UPLOAD';
        const { name, store } = await this.bucket(),
          path = `registration/${scope}/${id}/${contentHash(data)}/pdf/${version.id}.pdf`;
        const uploaded = await store.upload(path, bytes, {
          contentType: 'application/pdf',
          upsert: false,
          cacheControl: '0',
        });
        let stored = bytes;
        if (uploaded.error) {
          const retry = await store.download(path);
          if (retry.error || !retry.data) this.fail('storage-download-retry');
          stored = Buffer.from(await retry.data.arrayBuffer());
          await this.inspect(stored, 'REGISTRATION_PDF');
        }
        stage = 'DATABASE_ATTACHMENT';
        const values = {
          id: randomUUID(),
          kind: 'REGISTRATION_PDF',
          versionId: version.id,
          storageBucket: name,
          storagePath: path,
          mimeType: 'application/pdf',
          fileSize: stored.length,
          checksum: sha(stored),
          verifiedAt: new Date(),
        };
        const pdf =
          scope === 'application'
            ? await ApplicationEvidence.create(
                {
                  ...values,
                  applicationId: id,
                  contentHash: contentHash(data),
                },
                { transaction: t },
              )
            : await RegistrationFormDocument.create(
                { ...values, formId: id },
                { transaction: t },
              );
        stage = 'STORED_PDF_VERIFICATION';
        await this.download(pdf, scope, id, t);
        await owner.update({ documentStatus: 'READY' }, { transaction: t });
        if (scope === 'renewal')
          await RegistrationFormHistory.create(
            {
              formId: id,
              versionId: version.id,
              actorUuid: actorId ?? (owner as RegistrationForm).traineeUuid,
              action: 'PDF_GENERATED',
              metadata: { documentStatus: 'READY' },
            },
            { transaction: t },
          );
        return { status: 'READY' as const, versionId: version.id };
      });
    } catch (error) {
      const failure = {
        stage,
        ...(documentsStatus ? { documentsStatus } : {}),
        ...(invalidFields.length ? { invalidFields } : {}),
      };
      this.logger.warn(
        `Registration PDF failed ${JSON.stringify({ scope, formId: id, versionId: attemptedVersionId, ...failure })}`,
      );
      // The committed version remains intact. A retry revalidates the immutable
      // submission and reuses an already uploaded object after ambiguous failures.
      await this.db.transaction(async (t) => {
        const owner =
          scope === 'application'
            ? await TraineeApplication.findByPk(id, {
                transaction: t,
                lock: t.LOCK.UPDATE,
              })
            : await RegistrationForm.findByPk(id, {
                transaction: t,
                lock: t.LOCK.UPDATE,
              });
        if (
          owner &&
          attemptedVersionId &&
          owner.status === 'PENDING_REVIEW' &&
          owner.documentStatus !== 'READY'
        ) {
          const latest =
            scope === 'application'
              ? await ApplicationVersion.findOne({
                  where: { applicationId: id },
                  order: [['versionNumber', 'DESC']],
                  transaction: t,
                })
              : await RegistrationFormVersion.findOne({
                  where: { formId: id },
                  order: [['versionNumber', 'DESC']],
                  transaction: t,
                });
          if (latest?.id === attemptedVersionId) {
            await owner.update(
              { documentStatus: 'FAILED' },
              { transaction: t },
            );
            if (scope === 'renewal')
              await RegistrationFormHistory.create(
                {
                  formId: id,
                  versionId: latest.id,
                  actorUuid: actorId ?? (owner as RegistrationForm).traineeUuid,
                  action: 'PDF_FAILED',
                  metadata: { documentStatus: 'FAILED', ...failure },
                },
                { transaction: t },
              );
          }
        }
      });
      if (error instanceof ConflictException) throw error;
      this.fail('render-lock');
    }
  }
}

export function safeRenderFields(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const roots = new Set([
    'template',
    'version',
    'declarationVersion',
    'registration',
    'trainee',
    'parents',
    'emergencyContact',
    'education',
    'medical',
    'developmental',
    'physician',
    'signatures',
  ]);
  return value
    .filter(
      (x): x is string =>
        typeof x === 'string' &&
        x.length <= 120 &&
        roots.has(x.split('.')[0]) &&
        /^[A-Za-z][A-Za-z0-9]*(\.(?:[A-Za-z][A-Za-z0-9]*|\d{1,3}))*$/.test(x),
    )
    .slice(0, 20);
}

export function submittedEvidence<
  T extends { id: string; versionId: string | null },
>(
  docs: T[],
  versions: { id: string; formData: RegistrationData | VolunteerData }[],
): T[] {
  const ids = new Set(
    versions.flatMap((v) => {
      const data = v.formData as RegistrationData & VolunteerData;
      return [
        data.medical?.physicianSummaryDocumentId,
        data.policeClearanceDocumentId,
        ...Object.values(data.signatures ?? {}).map((s) => s.documentId),
      ];
    }),
  );
  return docs.filter(
    (d) =>
      ids.has(d.id) ||
      (d.versionId && versions.some((v) => v.id === d.versionId)),
  );
}
