import { randomUUID } from 'crypto';
import { AdmissionService } from './admission.service';
import { applicantToken, credentialHash } from './admission.security';
import { getNationalIdDetails } from '../user/national-id.util';
import { protectData } from '../parent-registration/registration.validation';
import { protectVolunteerData } from './volunteer.validation';

describe('Phase 2 identification and revision-bound branch updates (offline)', () => {
  const original = { ...process.env };
  const token = applicantToken();
  let service: AdmissionService, repo: any, app: any;
  beforeEach(() => {
    Object.assign(process.env, {
      NODE_ENV: 'development',
      ETLAASOT_RUNTIME_TARGET: 'development',
      BRANCH_NAME: 'dev',
      APPLICANT_PASSWORD_AUTH_ENABLED: 'true',
      APPLICATION_CREDENTIALS_SCHEMA_READY: 'true',
      APPLICANT_REGISTRATION_ENABLED: 'true',
      PARENT_ADMISSION_SCHEMA_READY: 'true',
      VOLUNTEER_REGISTRATION_ENABLED: 'true',
      DB_SYNC: 'false',
      DB_LOGGING: 'false',
      DB_SSL: 'true',
      DB_SSL_REJECT_UNAUTHORIZED: 'true',
      DB_USER: 'etlaasot_app.vlysppqfozfiwcmsyban',
      DB_HOST: 'aws-0-eu-central-1.pooler.supabase.com',
      DB_PORT: '5432',
      DB_NAME: 'postgres',
      SUPABASE_URL: 'https://vlysppqfozfiwcmsyban.supabase.co',
      NATIONAL_ID_HASH_SECRET: 'fictional-only',
      NATIONAL_ID_ENCRYPTION_KEY: 'a'.repeat(64),
      PARENT_REGISTRATION_TOKEN_PEPPER: 'b'.repeat(64),
    });
    delete process.env.RAILWAY_PROJECT_ID;
    delete process.env.RAILWAY_ENVIRONMENT_ID;
    delete process.env.RAILWAY_SERVICE_ID;
    app = {
      id: randomUUID(),
      nationalIdHash: getNationalIdDetails('123456782').nationalIdHash,
      branchId: 'a',
      registrationType: 'TRAINEE',
      status: 'DRAFT',
      revision: 0,
      draftData: protectData({ trainee: { nationalId: '123456782' } }),
    };
    app.update = jest.fn(async (data) => Object.assign(app, data));
    repo = {
      existingIdentity: jest.fn(async () => null),
      hasPasswordCredentials: jest.fn(async () => false),
      existingApplication: jest.fn(async () => null),
      transaction: jest.fn(async (work) => work({})),
      session: jest.fn(async (hash) => {
        if (hash !== credentialHash('session', token))
          throw Error('Invalid session');
        return { applicationId: app.id };
      }),
      application: jest.fn(async () => app),
      branch: jest.fn(async (id) => (id ? { id } : null)),
      evidence: jest.fn(async () => []),
    };
    service = new AdmissionService(
      repo,
      {} as any,
      {} as any,
      { availability: () => 'READY' } as any,
    );
  });
  afterEach(() => {
    process.env = { ...original };
  });
  it.each(['account', 'applicant', 'legacy', 'new'])(
    'returns only the next step for %s',
    async (kind) => {
      if (kind === 'account')
        repo.existingIdentity.mockResolvedValue({ id: 'private' });
      if (kind === 'applicant')
        repo.hasPasswordCredentials.mockResolvedValue(true);
      if (kind === 'legacy')
        repo.existingApplication.mockResolvedValue({ id: 'private' });
      expect(await service.identify('123456782', true)).toEqual({
        next: {
          account: 'PASSWORD',
          applicant: 'APPLICANT_PASSWORD',
          legacy: 'LEGACY_RECOVERY',
          new: 'REGISTER',
        }[kind],
      });
    },
  );
  it('preserves legacy identification without querying credentials when disabled', async () => {
    process.env.APPLICANT_PASSWORD_AUTH_ENABLED = 'false';
    expect(await service.identify('123456782', true)).toEqual({
      next: 'REGISTER',
    });
    expect(repo.hasPasswordCredentials).not.toHaveBeenCalled();
    expect(repo.existingApplication).not.toHaveBeenCalled();
  });
  it('keeps legacy clients unchanged even when password routing is available', async () => {
    repo.hasPasswordCredentials.mockResolvedValue(true);
    expect(await service.identify('123456782')).toEqual({ next: 'REGISTER' });
    expect(repo.hasPasswordCredentials).not.toHaveBeenCalled();
  });
  it.each(['TRAINEE', 'VOLUNTEER'])(
    'saves %s branch and draft in one revision',
    async (type) => {
      app.registrationType = type;
      app.branchId = null;
      const data =
        type === 'TRAINEE'
          ? { trainee: { nationalId: '123456782' } }
          : { volunteer: { nationalId: '123456782' } };
      app.draftData =
        type === 'TRAINEE'
          ? protectData(data as any)
          : protectVolunteerData(data as any);
      await service.save(token, {
        revision: 0,
        currentStep: 1,
        branchId: 'b',
        data,
      });
      expect(app).toMatchObject({ branchId: 'b', revision: 1, currentStep: 1 });
      expect(app.update).toHaveBeenCalledTimes(1);
    },
  );
  it('rejects stale revision without moving branch', async () => {
    await expect(
      service.save(token, {
        revision: 9,
        currentStep: 1,
        branchId: 'b',
        data: { trainee: { nationalId: '123456782' } },
      }),
    ).rejects.toThrow();
    expect(app.branchId).toBe('a');
    expect(app.update).not.toHaveBeenCalled();
  });
  it.each(['CHANGES_REQUESTED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'])(
    'preserves branch authorization after %s',
    async (status) => {
      app.status = status;
      await expect(
        service.save(token, {
          revision: 0,
          currentStep: 1,
          branchId: 'b',
          data: {},
        }),
      ).rejects.toThrow(status === 'APPROVED' ? 'regular account login' : 'after submission');
      expect(app.update).not.toHaveBeenCalled();
    },
  );
  it('rejects inactive branch', async () => {
    repo.branch.mockResolvedValue(null);
    await expect(
      service.save(token, {
        revision: 0,
        currentStep: 1,
        branchId: 'inactive',
        data: {},
      }),
    ).rejects.toThrow('active branch');
    expect(app.update).not.toHaveBeenCalled();
  });
  it('prevents reassignment of signed evidence', async () => {
    repo.evidence.mockResolvedValue([{ kind: 'SIGNATURE' }]);
    await expect(
      service.save(token, {
        revision: 0,
        currentStep: 1,
        branchId: 'b',
        data: {},
      }),
    ).rejects.toThrow('after signing');
    expect(app.update).not.toHaveBeenCalled();
  });
  it('does not enable branch mutation when flag is false', async () => {
    process.env.APPLICANT_PASSWORD_AUTH_ENABLED = 'false';
    await expect(
      service.save(token, {
        revision: 0,
        currentStep: 1,
        branchId: 'b',
        data: {},
      }),
    ).rejects.toThrow();
    expect(app.update).not.toHaveBeenCalled();
  });
  it('rejects branchless submission before evidence processing', async () => {
    app.branchId = null;
    repo.versions = jest.fn(async () => []);
    await expect(
      service.submit(token, { revision: 0, idempotencyKey: randomUUID() }),
    ).rejects.toThrow('active branch');
  });
  it('rejects signing without an active branch', async () => {
    app.branchId = null;
    await expect(
      service.upload(token, 0, 'SIGNATURE', Buffer.from('fictional')),
    ).rejects.toThrow('active branch');
  });
});
