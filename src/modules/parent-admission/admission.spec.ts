// Offline component tests only. No AppModule, environment files or database.
import { randomBytes, randomUUID } from 'crypto';
import { AdmissionService } from './admission.service';
import { AdmissionRepository } from './admission.repository';
import {
  AdmissionEvidenceGateway,
  UnavailableAdmissionEvidence,
} from './admission.evidence';
import {
  AdmissionRateLimiter,
  applicantToken,
  credentialHash,
} from './admission.security';
import { AuthorizationService } from '../auth/authorization.service';
import UserService from '../user/user.service';
import { fictionalRegistration } from '../parent-registration/registration.test-fixtures';
import {
  contentHash,
  protectData,
  readData,
} from '../parent-registration/registration.validation';
import {
  DECLARATIONS,
  DECLARATION_VERSION,
} from '../parent-registration/declarations';
import { getNationalIdDetails } from '../user/national-id.util';
import { admissionFeatureModules } from './admission.module';
import type { ApplicationEvidence } from './admission.entities';

describe('Phase 4 applicant trust boundary (offline)', () => {
  const original = { ...process.env };
  let service: AdmissionService,
    repo: any,
    users: any,
    evidence: any,
    app: any,
    session: any,
    versions: any[],
    docs: any[],
    t: any;
  const token = applicantToken(),
    recovery = applicantToken(),
    actor = {
      userId: randomUUID(),
      roles: [{ roleId: 10000, branchId: 'branch-a' }],
    };
  beforeEach(() => {
    process.env.NATIONAL_ID_HASH_SECRET = 'fictional-test-hash-secret';
    process.env.NATIONAL_ID_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    process.env.PARENT_REGISTRATION_TOKEN_PEPPER =
      randomBytes(32).toString('hex');
    process.env.APPLICANT_REGISTRATION_ENABLED = 'true';
    delete process.env.ID_FIRST_LOGIN_ENABLED;
    delete process.env.PARENT_ADMISSION_SCHEMA_READY;
    t = { LOCK: { UPDATE: 'UPDATE' } };
    app = {
      id: randomUUID(),
      nationalIdHash: getNationalIdDetails('123456782').nationalIdHash,
      branchId: 'branch-a',
      status: 'DRAFT',
      revision: 0,
      currentStep: 1,
      draftData: protectData({ trainee: { nationalId: '123456782' } }),
      documentStatus: 'PENDING',
      feedbackReason: null,
    };
    app.update = jest.fn(async (values) => Object.assign(app, values));
    session = {
      applicationId: app.id,
      tokenHash: credentialHash('session', token),
      recoveryHash: credentialHash('recovery', recovery),
      expiresAt: new Date(Date.now() + 1000),
      recoveryExpiresAt: new Date(Date.now() + 86400000),
      revokedAt: null,
    };
    session.update = jest.fn(async (values) => Object.assign(session, values));
    versions = [];
    docs = [];
    repo = {
      transaction: jest.fn((work) => work(t)),
      existingIdentity: jest.fn(async () => null),
      branches: jest.fn(async () => [
        { id: 'branch-a', name: 'Fictional', city: 'Test' },
      ]),
      branch: jest.fn(async () => ({ id: 'branch-a' })),
      currentYear: jest.fn(async () => randomUUID()),
      create: jest.fn(async (values) => Object.assign(app, values)),
      createSession: jest.fn(async (values) => Object.assign(session, values)),
      session: jest.fn(async (hash, isRecovery) => {
        if (
          session.revokedAt ||
          hash !== (isRecovery ? session.recoveryHash : session.tokenHash) ||
          (isRecovery ? session.recoveryExpiresAt : session.expiresAt) <=
            new Date()
        )
          throw Error('Credential denied');
        return session;
      }),
      application: jest.fn(async () => app),
      versions: jest.fn(async () => versions),
      evidence: jest.fn(async () => docs),
      events: jest.fn(async () => []),
      event: jest.fn(async () => {}),
      version: jest.fn(async (values) => {
        const v = { id: randomUUID(), ...values };
        versions.unshift(v);
        return v;
      }),
      list: jest.fn(async () => ({ rows: [], count: 0 })),
    };
    users = {
      createTraineeWithRole: jest.fn(async () => ({
        user: { id: randomUUID() },
        temporaryPassword: 'fictional-once-only',
        temporaryPasswordExpiresAt: new Date(),
      })),
    };
    evidence = {
      availability: () => 'READY',
      verify: jest.fn(async () => {}),
      generate: jest.fn(async () => {}),
    };
    service = new AdmissionService(
      repo,
      new AuthorizationService(),
      users,
      evidence,
    );
  });
  afterAll(() => {
    process.env = original;
  });
  it('starts registration for an ordinary active DEV branch after connection attestation', async () => {
    const integration = {
      enabled: () => true,
      attest: jest.fn().mockResolvedValue(undefined),
    };
    const integrated = new AdmissionService(
      repo,
      new AuthorizationService(),
      users,
      evidence,
      integration as never,
    );
    await expect(
      integrated.start('123456782', 'branch-a'),
    ).resolves.toBeDefined();
    expect(integration.attest).toHaveBeenCalled();
    expect(repo.branch).toHaveBeenCalledWith('branch-a', t);
    expect(repo.create).toHaveBeenCalled();
  });
  it('lists applicant names and current PDF references without exposing protected form data', async () => {
    const pdfDocumentId = randomUUID();
    app.documentStatus = 'READY';
    app.draftData = protectData({
      trainee: { nationalId: '123456782', name: 'חניך בדיקה' },
    });
    repo.list.mockResolvedValue({
      rows: [app],
      count: 1,
      pdfDocumentIds: new Map([[app.id, pdfDocumentId]]),
    });

    const result = await service.list(actor, 'branch-a', 1);

    expect(result).toEqual({
      count: 1,
      rows: [
        expect.objectContaining({
          id: app.id,
          applicantName: 'חניך בדיקה',
          pdfDocumentId,
        }),
      ],
    });
    expect(result.rows[0]).not.toHaveProperty('draftData');
    expect(repo.list).toHaveBeenCalledWith(
      ['branch-a'],
      1,
      'TRAINEE',
      undefined,
      undefined,
    );
  });
  function submitted(two = true) {
    const data = fictionalRegistration(two),
      hash = contentHash(data);
    const version = {
      id: randomUUID(),
      applicationId: app.id,
      versionNumber: 1,
      submittedRevision: 0,
      idempotencyKey: randomUUID(),
      formData: protectData(data),
      contentHash: hash,
      declarations: [...DECLARATIONS],
      declarationVersion: DECLARATION_VERSION,
    };
    versions = [version];
    app.draftData = protectData(data);
    docs = [
      {
        id: data.medical!.physicianSummaryDocumentId,
        kind: 'PHYSICIAN_SUMMARY',
      },
      ...Object.values(data.signatures!).map((s) => ({
        id: s.documentId,
        kind: 'SIGNATURE',
      })),
      { id: randomUUID(), kind: 'REGISTRATION_PDF', versionId: version.id },
    ].map((d) => ({
      ...d,
      applicationId: app.id,
      contentHash: hash,
      mimeType: d.kind === 'SIGNATURE' ? 'image/png' : 'application/pdf',
      verifiedAt: new Date(),
      fileSize: 100,
      checksum: 'a'.repeat(64),
    }));
    return { data, version, hash };
  }
  it('defaults all Phase 4 features off without requiring a pepper or querying tables', () => {
    delete process.env.APPLICANT_REGISTRATION_ENABLED;
    delete process.env.PARENT_REGISTRATION_TOKEN_PEPPER;
    expect(admissionFeatureModules()).toEqual([]);
    expect(repo.transaction).not.toHaveBeenCalled();
  });
  it('fails startup unless schema approval marker and safe SQL settings are explicit', () => {
    expect(() => admissionFeatureModules()).toThrow('migration 031');
    process.env.PARENT_ADMISSION_SCHEMA_READY = 'true';
    process.env.DB_SYNC = 'true';
    expect(() => admissionFeatureModules()).toThrow('DB_SYNC');
    delete process.env.DB_SYNC;
    process.env.DB_LOGGING = 'true';
    expect(() => admissionFeatureModules()).toThrow('DB_LOGGING');
    delete process.env.DB_LOGGING;
  });
  it('identification returns only a next step for every role, not account information', async () => {
    repo.existingIdentity.mockResolvedValue({
      id: 'private-account',
      name: 'never-return',
    });
    expect(await service.identify('123456782')).toEqual({ next: 'PASSWORD' });
    repo.existingIdentity.mockResolvedValue(null);
    expect(await service.identify('123456782')).toEqual({ next: 'REGISTER' });
    process.env.APPLICANT_REGISTRATION_ENABLED = 'false';
    expect(await service.identify('123456782')).toEqual({ next: 'PASSWORD' });
  });
  it('creates only an untrusted encrypted application and hashed credentials', async () => {
    const result = await service.start('123456782', 'branch-a');
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.recoveryCode).not.toBe(result.token);
    expect(session.tokenHash).toBe(credentialHash('session', result.token));
    expect(JSON.stringify(repo.create.mock.calls)).not.toContain('123456782');
    expect(JSON.stringify(repo.createSession.mock.calls)).not.toContain(
      result.token,
    );
    expect(users.createTraineeWithRole).not.toHaveBeenCalled();
  });
  it('refuses inactive branches and duplicate existing accounts before application creation', async () => {
    repo.branch.mockResolvedValue(null);
    await expect(service.start('123456782', 'branch-a')).rejects.toThrow();
    repo.branch.mockResolvedValue({ id: 'branch-a' });
    repo.existingIdentity.mockResolvedValue({ id: 'existing' });
    await expect(service.start('123456782', 'branch-a')).rejects.toThrow(
      'Unable to start',
    );
    expect(repo.create).not.toHaveBeenCalled();
  });
  it('maps unique-constraint races to a generic conflict without returning another application', async () => {
    repo.create.mockRejectedValue({
      name: 'SequelizeUniqueConstraintError',
      sql: 'sensitive',
    });
    await expect(service.start('123456782', 'branch-a')).rejects.toThrow(
      'Unable to start',
    );
  });
  it('national ID and another high-entropy token cannot reopen a saved draft', async () => {
    await expect(
      Promise.resolve().then(() => service.me('123456782')),
    ).rejects.toThrow();
    await expect(service.me(applicantToken())).rejects.toThrow();
    expect(repo.application).not.toHaveBeenCalled();
    expect((await service.me(token)).data.trainee!.nationalId).toBe(
      '123456782',
    );
  });
  it('rotates session and recovery credentials atomically without extending absolute recovery lifetime', async () => {
    const absolute = session.recoveryExpiresAt.getTime(),
      old = session.tokenHash;
    const result = await service.recover(recovery);
    expect(session.tokenHash).not.toBe(old);
    expect(session.recoveryExpiresAt.getTime()).toBe(absolute);
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(absolute);
    await expect(service.me(token)).rejects.toThrow();
    await expect(service.recover(recovery)).rejects.toThrow();
  });
  it('revokes both session and recovery without changing applicant identity', async () => {
    await service.revoke(token);
    await expect(service.me(token)).rejects.toThrow();
    await expect(service.recover(recovery)).rejects.toThrow();
  });
  it('rejects expired session credentials', async () => {
    session.expiresAt = new Date(0);
    await expect(service.me(token)).rejects.toThrow();
  });
  it('prevents stale saves, immutable submitted edits and applicant identity replacement', async () => {
    await expect(
      service.save(token, {
        revision: 1,
        currentStep: 1,
        data: { trainee: { nationalId: '123456782' } },
      }),
    ).rejects.toThrow();
    await expect(
      service.save(token, {
        revision: 0,
        currentStep: 1,
        data: { trainee: { nationalId: '000000018' } },
      }),
    ).rejects.toThrow('identity');
    app.status = 'PENDING_REVIEW';
    await expect(
      service.save(token, { revision: 0, currentStep: 1, data: {} }),
    ).rejects.toThrow();
  });
  it('content changes invalidate both signatures and persist protected IDs', async () => {
    const { data } = submitted();
    data.trainee!.address = 'new fictional address';
    const result = await service.save(token, {
      revision: 0,
      currentStep: 2,
      data,
    });
    expect(result.data.signatures).toBeUndefined();
    expect(app.revision).toBe(1);
    expect(JSON.stringify(app.draftData)).not.toContain('123456782');
  });
  it.each([false, true])(
    'requires verified medical evidence and supports one/two parents (%s)',
    async (two) => {
      submitted(two);
      versions = [];
      docs = docs.filter((d) => d.kind !== 'REGISTRATION_PDF');
      const body = { revision: 0, idempotencyKey: randomUUID() };
      const result = await service.submit(token, body);
      expect(result.application.status).toBe('PENDING_REVIEW');
      expect(evidence.verify).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'PHYSICIAN_SUMMARY' }),
        ]),
      );
      const retry = await service.submit(token, body);
      expect(retry.idempotent).toBe(true);
      expect(repo.version).toHaveBeenCalledTimes(1);
    },
  );
  it('does not accept a missing summary or duplicate signature asset', async () => {
    const { data } = submitted();
    versions = [];
    docs = docs.filter((d) => d.kind !== 'PHYSICIAN_SUMMARY');
    await expect(
      service.submit(token, { revision: 0, idempotencyKey: randomUUID() }),
    ).rejects.toThrow();
    data.signatures!.parent2!.documentId = data.signatures!.parent1!.documentId;
    app.draftData = protectData(data);
    await expect(
      service.submit(token, { revision: 0, idempotencyKey: randomUUID() }),
    ).rejects.toThrow('separate');
  });
  it('rejects duplicate parent identities even when separate signature assets are supplied', async () => {
    const { data } = submitted();
    versions = [];
    data.parent2!.nationalId = data.parent1!.nationalId;
    for (const s of Object.values(data.signatures!))
      s.contentHash = contentHash(data);
    app.draftData = protectData(data);
    await expect(
      service.submit(token, { revision: 0, idempotencyKey: randomUUID() }),
    ).rejects.toThrow();
    expect(evidence.verify).not.toHaveBeenCalled();
  });
  it('default evidence adapter prevents submission even when references look plausible', async () => {
    submitted();
    versions = [];
    service = new AdmissionService(
      repo,
      new AuthorizationService(),
      users,
      new UnavailableAdmissionEvidence(),
    );
    await expect(
      service.submit(token, { revision: 0, idempotencyKey: randomUUID() }),
    ).rejects.toThrow('not available');
    expect(repo.version).not.toHaveBeenCalled();
  });
  it('branch administrators cannot read, review or approve another branch', async () => {
    app.branchId = 'branch-b';
    await expect(service.detail(actor, app.id)).rejects.toThrow();
    await expect(
      service.review(actor, app.id, 'REJECTED', 'reason', randomUUID()),
    ).rejects.toThrow();
    await expect(
      service.approve(actor, app.id, randomUUID(), true),
    ).rejects.toThrow();
    expect(users.createTraineeWithRole).not.toHaveBeenCalled();
  });
  it.each(['CHANGES_REQUESTED', 'REJECTED'] as const)(
    'reviews submitted evidence as %s without editing the signed version',
    async (action) => {
      const { version } = submitted();
      app.status = 'PENDING_REVIEW';
      const frozen = JSON.stringify(version);
      const result = await service.review(
        actor,
        app.id,
        action,
        '  fictional reason  ',
        version.id,
      );
      expect(result.status).toBe(action);
      expect(app.feedbackReason).toBe('fictional reason');
      expect(JSON.stringify(version)).toBe(frozen);
      expect(readData(app.draftData).signatures).toBeUndefined();
    },
  );
  it('requires current PDF, explicit identity verification and working evidence integration before provisioning', async () => {
    const { version } = submitted();
    app.status = 'PENDING_REVIEW';
    await expect(
      Promise.resolve().then(() =>
        service.approve(actor, app.id, version.id, false),
      ),
    ).rejects.toThrow();
    await expect(
      service.approve(actor, app.id, version.id, true),
    ).rejects.toThrow('PDF');
    app.documentStatus = 'READY';
    service = new AdmissionService(
      repo,
      new AuthorizationService(),
      users,
      new UnavailableAdmissionEvidence(),
    );
    await expect(
      service.approve(actor, app.id, version.id, true),
    ).rejects.toThrow('not available');
    expect(users.createTraineeWithRole).not.toHaveBeenCalled();
  });
  it('approval provisions only through existing user service inside the outer transaction', async () => {
    const { version } = submitted();
    app.status = 'PENDING_REVIEW';
    app.documentStatus = 'READY';
    const result = await service.approve(actor, app.id, version.id, true);
    expect(users.createTraineeWithRole).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '123456782',
        branchId: 'branch-a',
        isActive: true,
      }),
      t,
    );
    expect(result.application.status).toBe('APPROVED');
    expect(result.temporaryPassword).toBe('fictional-once-only');
    expect(app.approvedActivityYearId).toBeTruthy();
    expect(JSON.stringify(repo.event.mock.calls)).not.toContain(
      'fictional-once-only',
    );
    await expect(
      service.approve(actor, app.id, version.id, true),
    ).rejects.toThrow();
    expect(users.createTraineeWithRole).toHaveBeenCalledTimes(1);
  });
  it('propagates failures through the approval transaction instead of independently committing the account', async () => {
    const { version } = submitted();
    app.status = 'PENDING_REVIEW';
    app.documentStatus = 'READY';
    repo.event.mockRejectedValueOnce(Error('event write failed'));
    await expect(
      service.approve(actor, app.id, version.id, true),
    ).rejects.toThrow('event write failed');
    expect(users.createTraineeWithRole.mock.calls[0][1]).toBe(t);
    expect(repo.transaction).toHaveBeenCalledTimes(1);
  });
  it('HMAC domains differ and the shared limiter atomically denies exhausted counters', async () => {
    expect(credentialHash('session', token)).not.toBe(
      credentialHash('recovery', token),
    );
    const query = jest.fn(async (_sql: string, _options?: unknown) => [
      { attempts: 601 },
    ]);
    const limiter = new AdmissionRateLimiter({ query } as never);
    await expect(
      limiter.consume('identify', '127.0.0.1', '123456782'),
    ).rejects.toMatchObject({ status: 429 });
    expect(query.mock.calls[0][0]).toContain('ON CONFLICT');
    expect(JSON.stringify(query.mock.calls)).not.toContain('123456782');
  });
  it('fails closed without logging database diagnostics when abuse storage is unavailable', async () => {
    const limiter = new AdmissionRateLimiter({
      query: async () => {
        throw { sql: 'private diagnostic' };
      },
    } as never);
    await expect(limiter.consume('identify', 'fictional-peer')).rejects.toThrow(
      'abuse controls are unavailable',
    );
  });
  it('keeps old starts and records compatible with the TRAINEE policy', async () => {
    const old = await service.me(token);
    expect(old.application.registrationType).toBe('TRAINEE');
    expect(old.declarations).toEqual(DECLARATIONS);
    await service.start('123456782', 'branch-a');
    expect(repo.create.mock.calls[0][0].registrationType).toBe('TRAINEE');
  });
  it.each(['false'])(
    'never starts volunteer admission with preparation flag %s',
    async (flag) => {
      process.env.VOLUNTEER_REGISTRATION_ENABLED = flag;
      await expect(
        service.start('123456782', 'branch-a', 'VOLUNTEER'),
      ).rejects.toThrow();
      expect(repo.transaction).not.toHaveBeenCalled();
      expect(repo.create).not.toHaveBeenCalled();
    },
  );
  it('never sends a volunteer application through trainee lifecycle operations', async () => {
    app.registrationType = 'VOLUNTEER';
    process.env.VOLUNTEER_REGISTRATION_ENABLED = 'false';
    app.status = 'PENDING_REVIEW';
    await expect(service.me(token)).rejects.toThrow();
    await expect(
      service.save(token, { revision: 0, currentStep: 1, data: {} }),
    ).rejects.toThrow();
    await expect(
      service.submit(token, { revision: 0, idempotencyKey: randomUUID() }),
    ).rejects.toThrow();
    await expect(
      service.upload(token, 0, 'POLICE_CLEARANCE', Buffer.from('fictional')),
    ).rejects.toThrow();
    await expect(service.retry(token)).rejects.toThrow();
    await expect(service.adminRetry(actor, app.id)).rejects.toThrow();
    await expect(service.detail(actor, app.id)).rejects.toThrow();
    await expect(
      service.review(actor, app.id, 'REJECTED', 'test', randomUUID()),
    ).rejects.toThrow();
    await expect(
      service.approve(actor, app.id, randomUUID(), true),
    ).rejects.toThrow();
    expect(app.update).not.toHaveBeenCalled();
    expect(users.createTraineeWithRole).not.toHaveBeenCalled();
  });
  it('does not let a draft request replace its persisted registration type', async () => {
    app.registrationType = 'VOLUNTEER';
    await expect(
      service.save(token, {
        revision: 0,
        currentStep: 1,
        data: { trainee: { nationalId: '123456782' } },
      }),
    ).rejects.toThrow();
    expect(app.update).not.toHaveBeenCalled();
  });
});
