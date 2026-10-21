import { randomBytes, randomUUID } from 'crypto';
import { AuthorizationService } from '../auth/authorization.service';
import { DeferredRegistrationDocumentGenerator } from './registration-document.generator';
import {
  RegistrationService,
  approvedProfileMapping,
} from './registration.service';
import { contentHash, protectData, readData } from './registration.validation';
import { fictionalRegistration } from './registration.test-fixtures';

describe('Parent registration lifecycle (offline repository doubles)', () => {
  const trainee = randomUUID(),
    outsider = randomUUID(),
    formId = randomUUID(),
    year = randomUUID();
  const actors = {
    trainee: { userId: trainee, roles: [{ roleId: 2 }] },
    outsider: { userId: outsider, roles: [{ roleId: 2 }] },
    admin: {
      userId: randomUUID(),
      roles: [{ roleId: 10000, resourceId: 'a' }],
    },
    otherAdmin: {
      userId: randomUUID(),
      roles: [{ roleId: 10000, resourceId: 'b' }],
    },
    super: { userId: randomUUID(), roles: [{ roleId: 10001 }] },
    volunteer: { userId: outsider, roles: [{ roleId: 1, resourceId: 'a' }] },
  };
  let repo: any,
    service: RegistrationService,
    form: any,
    user: any,
    versions: any[],
    docs: any[],
    annual: any;
  let oldKey: string | undefined;
  const row = (data: any) => ({
    ...data,
    update: jest.fn(async function (this: any, next: any) {
      Object.assign(this, next);
      return this;
    }),
  });
  beforeAll(() => {
    oldKey = process.env.NATIONAL_ID_ENCRYPTION_KEY;
    process.env.NATIONAL_ID_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  });
  afterAll(() => {
    if (oldKey === undefined) delete process.env.NATIONAL_ID_ENCRYPTION_KEY;
    else process.env.NATIONAL_ID_ENCRYPTION_KEY = oldKey;
  });
  beforeEach(() => {
    const data = fictionalRegistration();
    form = row({
      id: formId,
      traineeUuid: trainee,
      branchId: 'a',
      activityYearId: year,
      requestType: 'YEARLY',
      status: 'DRAFT',
      draftRevision: 2,
      currentStep: 5,
      blocksAccess: true,
      documentStatus: 'PENDING',
      draftData: protectData(data),
    });
    user = row({
      id: trainee,
      branchId: 'a',
      name: 'Existing',
      allergies: 'Keep existing allergy',
    });
    versions = [];
    annual = { activityYearId: year };
    docs = [
      {
        id: data.medical!.physicianSummaryDocumentId,
        kind: 'PHYSICIAN_SUMMARY',
      },
      ...Object.values(data.signatures!).map((s) => ({
        id: s.documentId,
        kind: 'SIGNATURE',
      })),
    ].map((d) => ({
      ...d,
      formId,
      verifiedAt: new Date(),
      fileSize: 100,
      checksum: 'a'.repeat(64),
    }));
    repo = {
      transaction: jest.fn((work) => work({ LOCK: { UPDATE: 'UPDATE' } })),
      lockTrainee: jest.fn(async (id) => ({
        user: id === trainee ? user : row({ id, branchId: 'b' }),
        roles: [{ roleId: 2 }],
      })),
      active: jest.fn(async () => form),
      annualRequirement: jest.fn(async () => annual),
      latestApproved: jest.fn(async () => null),
      form: jest.fn(async () => form),
      formReference: jest.fn(async () => form),
      latestVersion: jest.fn(async () => versions[0]),
      versions: jest.fn(async () => versions),
      documents: jest.fn(async () => docs),
      medications: jest.fn(async () => []),
      idempotent: jest.fn(async (_id, key) =>
        versions.find((v) => v.idempotencyKey === key),
      ),
      createVersion: jest.fn(async (values) => {
        const v = { ...values, id: randomUUID() };
        versions.unshift(v);
        return v;
      }),
      createForm: jest.fn(
        async (values) =>
          (form = row({
            ...values,
            id: randomUUID(),
            draftRevision: 0,
            status: 'DRAFT',
            draftData: values.draftData ?? {},
          })),
      ),
      history: jest.fn(async () => undefined),
      openYear: jest.fn(),
      openPeriod: jest.fn(),
      list: jest.fn(),
      years: jest.fn(),
    };
    service = new RegistrationService(
      repo,
      new AuthorizationService(),
      new DeferredRegistrationDocumentGenerator(),
    );
  });
  const submit = () => ({ formId, revision: 2, idempotencyKey: randomUUID() });
  it('derives self identity from auth and rejects volunteers', async () => {
    await service.status(actors.trainee);
    expect(repo.lockTrainee).toHaveBeenCalledWith(trainee, expect.anything());
    expect(() => service.status(actors.volunteer)).toThrow();
  });
  it('prevents cross-trainee submission before reading signed data', async () => {
    await expect(service.submit(actors.outsider, submit())).rejects.toThrow(
      'ownership',
    );
    expect(repo.documents).not.toHaveBeenCalled();
  });
  it('rejects stale autosave revisions', async () => {
    await expect(
      service.saveDraft(actors.trainee, {
        revision: 1,
        currentStep: 1,
        data: {},
      }),
    ).rejects.toThrow('Reload');
    expect(form.update).not.toHaveBeenCalled();
  });
  it('invalidates both signatures on meaningful edits and encrypts updated IDs', async () => {
    const data = readData(form.draftData);
    data.trainee!.name = 'Changed';
    const result = await service.saveDraft(actors.trainee, {
      revision: 2,
      currentStep: 1,
      data,
    });
    expect(result.data.signatures).toBeUndefined();
    expect(result.form?.revision).toBe(3);
    expect(form.draftData.trainee.nationalId).toMatch(/^v1:/);
  });
  it('accepts completed signatures only for unchanged content', async () => {
    const data = readData(form.draftData);
    const result = await service.saveDraft(actors.trainee, {
      revision: 2,
      currentStep: 5,
      data,
    });
    expect(result.data.signatures).toEqual(data.signatures);
  });
  it('enforces final validation and verified attachments', async () => {
    docs = [];
    await expect(service.submit(actors.trainee, submit())).rejects.toThrow(
      'verified private attachment',
    );
    expect(repo.createVersion).not.toHaveBeenCalled();
  });
  it('preserves an immutable snapshot and idempotent retries with pending document state', async () => {
    const input = submit();
    const result = await service.submit(actors.trainee, input);
    expect(result.form?.status).toBe('PENDING_REVIEW');
    expect(result.form?.documentStatus).toBe('PENDING');
    const evidence = structuredClone(versions[0]);
    expect(await service.submit(actors.trainee, input)).toMatchObject({
      versionId: result.versionId,
      idempotent: true,
    });
    expect(repo.createVersion).toHaveBeenCalledTimes(1);
    await expect(
      service.saveDraft(actors.trainee, {
        revision: 2,
        currentStep: 1,
        data: {},
      }),
    ).rejects.toThrow('immutable');
    await expect(
      service.submit(actors.trainee, { ...input, revision: 3 }),
    ).rejects.toThrow('different submission');
    await service.requestChanges(
      actors.admin,
      formId,
      'Please correct the contact',
    );
    expect(form.draftData.signatures).toBeUndefined();
    expect(versions[0]).toEqual(evidence);
    expect(form.status).toBe('CHANGES_REQUESTED');
    expect(form.draftRevision).toBe(3);
    const next = readData(form.draftData);
    const oldSignatures = readData(evidence.formData).signatures;
    next.signatures = oldSignatures;
    await service.saveDraft(actors.trainee, {
      revision: 3,
      currentStep: 5,
      data: next,
    });
    await expect(
      service.submit(actors.trainee, { ...submit(), revision: 4 }),
    ).rejects.toThrow('new completed signature');
    next.signatures = {
      parent1: {
        documentId: randomUUID(),
        contentHash: contentHash(next),
        signedAt: new Date().toISOString(),
      },
    };
    docs.push({ ...docs[1], id: next.signatures.parent1!.documentId });
    await service.saveDraft(actors.trainee, {
      revision: 4,
      currentStep: 5,
      data: next,
    });
    await service.submit(actors.trainee, { ...submit(), revision: 5 });
    expect(versions.map((v) => v.versionNumber)).toEqual([2, 1]);
    expect(versions[1]).toEqual(evidence);
    expect(repo.history.mock.calls.some((c) => c[1] === 'RESUBMITTED')).toBe(
      true,
    );
  });
  it.each(['otherAdmin', 'volunteer'] as const)(
    'denies %s from branch review/open/renewal',
    async (key) => {
      await expect(service.detail(actors[key], formId)).rejects.toThrow();
      expect(() =>
        service.openPeriod(actors[key], {
          branchId: 'a',
          activityYearId: year,
        }),
      ).toThrow();
      expect(() =>
        service.renew(actors[key], trainee, {
          branchId: 'a',
          activityYearId: year,
          blocksAccess: false,
          reason: 'Renew',
        }),
      ).toThrow();
    },
  );
  it('applies admin scope on lists and accepts super admin', async () => {
    service.list(actors.admin, { page: 1, pageSize: 25 });
    expect(repo.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ branchIds: ['a'] }),
    );
    service.list(actors.super, { page: 1, pageSize: 25 });
    expect(repo.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ branchIds: undefined }),
    );
    await service.detail(actors.super, formId);
  });
  it('denies historical-branch admins after a trainee transfers', async () => {
    user.branchId = 'b';
    await expect(service.detail(actors.admin, formId)).rejects.toThrow();
    await expect(service.submit(actors.trainee, submit())).rejects.toThrow(
      'branch changed',
    );
  });
  it('requires a written request-changes/renewal reason', async () => {
    expect(() => service.requestChanges(actors.admin, formId, '  ')).toThrow();
    expect(() =>
      service.renew(actors.admin, trainee, {
        reason: ' ',
        branchId: 'a',
        activityYearId: year,
        blocksAccess: false,
      }),
    ).toThrow();
  });
  it('blocks approval without the current verified PDF even if READY is set', async () => {
    await service.submit(actors.trainee, submit());
    form.documentStatus = 'READY';
    await expect(
      service.approve(actors.admin, formId, versions[0].id),
    ).rejects.toThrow('verified in private storage');
    expect(user.update).not.toHaveBeenCalled();
  });
  it('maps approved fields in the same transaction without writing medical records', async () => {
    await service.submit(actors.trainee, submit());
    form.documentStatus = 'READY';
    docs.push({
      kind: 'REGISTRATION_PDF',
      versionId: versions[0].id,
      mimeType: 'application/pdf',
      verifiedAt: new Date(),
      fileSize: 100,
      checksum: 'b'.repeat(64),
    });
    await service.approve(actors.super, formId, versions[0].id);
    expect(form.status).toBe('APPROVED');
    expect(user.allergies).toBe('Keep existing allergy');
    const [mapping, options] = user.update.mock.calls[0];
    expect(mapping).toEqual(approvedProfileMapping(fictionalRegistration()));
    for (const key of [
      'allergies',
      'medications',
      'notes',
      'nationalId',
      'branchId',
      'userRoles',
    ])
      expect(mapping).not.toHaveProperty(key);
    expect(form.update.mock.calls.at(-1)[1].transaction).toBe(
      options.transaction,
    );
    expect(repo.history).toHaveBeenLastCalledWith(
      actors.super.userId,
      'APPROVED',
      options.transaction,
      expect.anything(),
    );
  });
  it('requires administrators to approve the version they reviewed', async () => {
    await service.submit(actors.trainee, submit());
    await expect(
      service.approve(actors.admin, formId, randomUUID()),
    ).rejects.toThrow('review the current');
    expect(user.update).not.toHaveBeenCalled();
  });
  it('creates annual drafts lazily for new trainees and blocks only in disabled policy metadata', async () => {
    repo.active.mockResolvedValue(null);
    expect(await service.status(actors.trainee)).toMatchObject({
      annualRequired: true,
      wouldBlockAccess: true,
      accessBlocked: false,
    });
    await service.saveDraft(actors.trainee, {
      revision: 0,
      currentStep: 2,
      data: {},
    });
    expect(repo.createForm).toHaveBeenCalledWith(
      expect.objectContaining({ requestType: 'YEARLY', blocksAccess: true }),
      expect.anything(),
    );
  });
  it('does not create unsolicited registrations outside an open period', async () => {
    repo.active.mockResolvedValue(null);
    annual = null;
    await expect(
      service.saveDraft(actors.trainee, {
        revision: 0,
        currentStep: 1,
        data: {},
      }),
    ).rejects.toThrow('No registration');
  });
  it('prevents duplicate renewals and preserves prior approved evidence', async () => {
    const input = {
      branchId: 'a',
      activityYearId: year,
      blocksAccess: false,
      reason: 'Annual medical update requested',
    };
    await expect(service.renew(actors.admin, trainee, input)).rejects.toThrow(
      'already has an active',
    );
    repo.active.mockResolvedValue(null);
    repo.latestApproved.mockResolvedValue({ id: formId });
    const old = { id: randomUUID(), formData: form.draftData };
    versions = [old];
    const result = await service.renew(actors.admin, trainee, input);
    expect(result).toMatchObject({
      requestType: 'INDIVIDUAL',
      blocksAccess: false,
    });
    expect(form.draftData.signatures).toBeUndefined();
    expect(form.draftData.medical.physicianSummaryDocumentId).toBeUndefined();
    expect(old.formData.signatures).toBeDefined();
  });
});
