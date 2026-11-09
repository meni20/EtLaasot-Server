// Offline transactional contract harness. No environment files, database or SMTP.
import { randomUUID } from 'crypto';
import { AdmissionService } from './admission.service';
import { AuthorizationService } from '../auth/authorization.service';
import UserService from '../user/user.service';
import AuthService from '../auth/auth.service';
import { hashPassword, verifyPassword } from '../auth/password.util';
import * as passwords from '../auth/password.util';
import { getNationalIdDetails } from '../user/national-id.util';
import { fictionalRegistration } from '../parent-registration/registration.test-fixtures';
import {
  protectData,
  contentHash,
} from '../parent-registration/registration.validation';
import {
  DECLARATIONS,
  DECLARATION_VERSION,
} from '../parent-registration/declarations';
import { admissionPolicy } from './admission.policy';
import { VOLUNTEER_TEMPLATE_VERSION } from './volunteer-render.contract';
import {
  volunteerContentHash,
  protectVolunteerData,
  volunteerScopeHash,
} from './volunteer.validation';
import {
  VOLUNTEER_AGREEMENT_VERSION as version,
  VOLUNTEER_SOURCE_SHA256,
} from './volunteer.legal';
import type { VolunteerData, VolunteerPurpose } from './volunteer.contract';
import { ApplicationCredentialsService } from './application-credentials.service';
const person = () => ({
  firstName: 'בדיקה',
  lastName: 'מקומית',
  nationalId: '123456782',
  dateOfBirth: '2000-01-01',
  gender: 'female' as const,
  address: 'כתובת',
  email: 'test@example.invalid',
  phone: '0520000000',
  shirtSize: 'M',
  motherName: 'אם',
  motherPhone: '0500000000',
  fatherName: 'אב',
  fatherPhone: '0500000001',
});
function complete(minor = false): VolunteerData {
  const data: VolunteerData = {
    volunteer: {
      ...person(),
      dateOfBirth: minor ? '2010-01-01' : '2000-01-01',
      school: 'בדיקה',
      grade: 'י',
    },
    questionnaire: {
      preference: 'משחקייה',
      age: 'קטן',
      communication: 'מדבר',
      diaper: 'ללא טיטול',
      instructionExperience: false,
      specialNeedsExperience: false,
      motivation: 'התנדבות',
    },
    agreements: { version, volunteer: true, confidentiality: true },
  };
  if (minor)
    data.parentConsent = {
      name: 'הורה',
      nationalId: '000000018',
      date: '2026-01-01',
      acknowledged: true,
    };
  for (const purpose of [
    'VOLUNTEER_AGREEMENT',
    ...(minor ? ['PARENTAL_CONSENT'] : []),
    'CONFIDENTIALITY',
  ] as VolunteerPurpose[]) {
    data.signatures ??= {};
    data.signatures[purpose] = {
      documentId: randomUUID(),
      signedAt: '2026-01-01T10:00:00.000Z',
      agreementVersion: version,
      contentHash: volunteerScopeHash(data, purpose),
    };
  }
  return data;
}

describe('Password approval lifecycle (offline transaction contracts)', () => {
  const saved = { ...process.env },
    clone = global.structuredClone;
  const password = 'Applicant!2345';
  let passwordHash: string;
  beforeAll(async () => {
    passwordHash = await hashPassword(password);
  });
  beforeEach(() => {
    Object.assign(process.env, {
      NATIONAL_ID_HASH_SECRET: 'fictional-approval-secret',
      NATIONAL_ID_ENCRYPTION_KEY: 'a'.repeat(64),
      PARENT_REGISTRATION_TOKEN_PEPPER: 'b'.repeat(64),
      APPLICANT_PASSWORD_AUTH_ENABLED: 'false',
      APPLICATION_CREDENTIALS_SCHEMA_READY: 'true',
      VOLUNTEER_REGISTRATION_ENABLED: 'true',
    });
    // Keep JSON fixtures in the Jest VM realm for strict plain-object validation.
    global.structuredClone = (value) => JSON.parse(JSON.stringify(value));
  });
  afterEach(() => {
    process.env = { ...saved };
    global.structuredClone = clone;
    jest.restoreAllMocks();
  });
  function harness(type: 'TRAINEE' | 'VOLUNTEER', legacy = false) {
    const data: any = type === 'TRAINEE' ? fictionalRegistration() : complete();
    const id = randomUUID(),
      actor = {
        userId: randomUUID(),
        roles: [{ roleId: 10000, branchId: 'branch-a' }],
      };
    const app: any = {
      id,
      registrationType: type,
      branchId: 'branch-a',
      status: 'PENDING_REVIEW',
      documentStatus: 'READY',
      nationalIdHash: getNationalIdDetails('123456782').nationalIdHash,
    };
    app.update = async (v: any) => Object.assign(app, v);
    const policy = admissionPolicy(type);
    const latest: any = {
      id: randomUUID(),
      registrationType: type,
      createdAt: new Date('2026-01-01T12:00:00Z'),
      formData:
        type === 'TRAINEE' ? protectData(data) : protectVolunteerData(data),
      contentHash:
        type === 'TRAINEE' ? contentHash(data) : volunteerContentHash(data),
      templateVersion:
        type === 'VOLUNTEER' ? VOLUNTEER_TEMPLATE_VERSION : undefined,
      declarationVersion:
        type === 'TRAINEE' ? DECLARATION_VERSION : policy.declarationVersion,
      declarations:
        type === 'TRAINEE' ? [...DECLARATIONS] : [...policy.declarations],
    };
    const docs: any[] = [
      ...(type === 'TRAINEE'
        ? [
            {
              id: data.medical.physicianSummaryDocumentId,
              kind: 'PHYSICIAN_SUMMARY',
            },
            ...Object.values(data.signatures).map((s: any) => ({
              id: s.documentId,
              kind: 'SIGNATURE',
            })),
          ]
        : []),
      { id: randomUUID(), kind: 'REGISTRATION_PDF', versionId: latest.id },
    ].map((d) => ({
      ...d,
      registrationType: type,
      contentHash: latest.contentHash,
      templateVersion: latest.templateVersion,
      sourceChecksum: VOLUNTEER_SOURCE_SHA256,
      generatedAt: new Date(),
      verifiedAt: new Date(),
      fileSize: 100,
      checksum: 'a'.repeat(64),
      mimeType: d.kind === 'SIGNATURE' ? 'image/png' : 'application/pdf',
    }));
    const state = {
      users: [] as any[],
      roles: [] as any[],
      revoked: false,
      events: [] as any[],
      notices: [] as any[],
    };
    let tail = Promise.resolve();
    const locks: string[] = [];
    const t = { LOCK: { UPDATE: 'UPDATE' } };
    const transaction = jest.fn((work: any) => {
      const next = tail.then(async () => {
        const before = structuredClone(state),
          previous = { ...app };
        try {
          return await work(t);
        } catch (error) {
          Object.assign(state, before);
          Object.assign(app, previous);
          throw error;
        }
      });
      tail = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    });
    const userRepo = {
      findByNationalIdHash: jest.fn(async () => state.users[0] ?? null),
      create: jest.fn(async (v: any, tx: any) => {
        expect(tx).toBe(t);
        state.users.push(v);
        return v;
      }),
    };
    const roles = {
      asignRoleToUser: jest.fn(async (...args: any[]) => {
        expect(args[3]).toBe(t);
        state.roles.push(args);
      }),
    };
    const users = new UserService(
      {
        transaction: jest.fn(() => {
          throw Error('Nested transaction');
        }),
      } as never,
      userRepo as never,
      roles as never,
    );
    const repo = {
      transaction,
      lockApplicantSession: jest.fn(async () => {
        locks.push('session');
      }),
      application: jest.fn(async () => {
        locks.push('application');
        return app;
      }),
      approvalCredential: jest.fn(async () =>
        legacy
          ? undefined
          : { passwordHash, loginEmail: 'family@example.test' },
      ),
      revokeApplicantSessions: jest.fn(async (_id: string, tx: any) => {
        expect(tx).toBe(t);
        state.revoked = true;
      }),
      session: jest.fn(async () => {
        if (state.revoked) throw Error('Revoked');
        return {
          applicationId: id,
          recoveryExpiresAt: new Date(Date.now() + 86400000),
        };
      }),
      versions: async () => [latest],
      evidence: async () => docs,
      branch: async () => ({ id: 'branch-a' }),
      currentYear: async () => randomUUID(),
      existingIdentity: jest.fn(async () => state.users[0] ?? null),
      event: jest.fn(async (...args: any[]) => {
        state.events.push(args);
      }),
    };
    const welcome = {
      enqueue: jest.fn(async (v: any, tx: any) => {
        expect(tx).toBe(t);
        state.notices.push(v);
        return { status: 'PENDING' };
      }),
      status: async () => ({ status: 'PENDING' }),
    };
    const integration = {
      enabled: () => true,
      attest: jest.fn(),
      verifySigned: jest.fn(),
      verifyVolunteerSigned: jest.fn(),
      download: jest.fn(),
    };
    const service = new AdmissionService(
      repo as never,
      new AuthorizationService(),
      users,
      {} as never,
      integration as never,
      welcome as never,
    );
    const approve = () => service.approve(actor, id, latest.id, true, true);
    return {
      approve,
      app,
      id,
      latest,
      actor,
      service,
      repo,
      state,
      userRepo,
      roles,
      users,
      t,
      locks,
      welcome,
    };
  }
  it.each(['TRAINEE', 'VOLUNTEER'] as const)(
    '%s transfers the original hash, preserves role/branch and supports regular login',
    async (type) => {
      const h = harness(type);
      const temporary = jest.spyOn(passwords, 'generateTemporaryPassword');
      const rehash = jest.spyOn(passwords, 'hashPassword');
      const result = await h.approve();
      const user = h.state.users[0];
      expect(user.passwordHash).toBe(passwordHash);
      expect(user.mustChangePassword).toBe(false);
      expect(user.temporaryPasswordExpiresAt).toBeNull();
      expect(await verifyPassword(user.passwordHash, password)).toBe(true);
      expect(h.state.roles[0][1]).toBe(type === 'TRAINEE' ? 2 : 1);
      expect(h.state.roles[0][4]).toBe('branch-a');
      expect(temporary).not.toHaveBeenCalled();
      expect(rehash).not.toHaveBeenCalled();
      expect(result).toMatchObject({ authentication: 'EXISTING_PASSWORD' });
      expect(result).not.toHaveProperty('temporaryPassword');
      expect(result).not.toHaveProperty('passwordHash');
      expect(JSON.stringify(result)).not.toContain(passwordHash);
      expect(JSON.stringify(result)).not.toContain(password);
      expect(h.locks.slice(0, 2)).toEqual(['session', 'application']);
      expect(h.state.revoked).toBe(true);
      expect(h.welcome.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          notificationOnly: true,
          email: 'family@example.test',
        }),
        h.t,
      );
      const auth = new AuthService(
        {query:async()=>[{revision:0,passwordHash:user.passwordHash}]} as never,
        {
          findRolesByUserId: async () => [
            { roleId: type === 'TRAINEE' ? 2 : 1, branchId: 'branch-a' },
          ],
        } as never,
        {
          findByNationalIdHashForAuth: async () => user,
          clearLoginFailures: jest.fn(),
        } as never,
        {
          getAllBranches: async () => [
            { id: 'branch-a', name: 'Synthetic', isActive: true },
          ],
        } as never,
        { sign: jest.fn(() => 'regular-jwt-after-login') } as never,
      );
      expect(await auth.login('123456782', password)).toMatchObject({
        token: 'regular-jwt-after-login',
        mustChangePassword: false,
      });
      await expect(h.service.me('s'.repeat(43))).rejects.toThrow();
      // Even a badly restored session is rejected from the current application state.
      h.state.revoked = false;
      await expect(h.service.me('s'.repeat(43))).rejects.toThrow(
        'regular account login',
      );
      await expect(h.service.recover('r'.repeat(43))).rejects.toThrow(
        'regular account login',
      );
    },
  );
  it.each(['TRAINEE', 'VOLUNTEER'] as const)(
    '%s concurrent approvals and retry provision once',
    async (type) => {
      const h = harness(type),
        results = await Promise.all([h.approve(), h.approve(), h.approve()]);
      expect(h.state.users).toHaveLength(1);
      expect(h.state.roles).toHaveLength(1);
      expect(h.state.events).toHaveLength(1);
      expect(h.state.notices).toHaveLength(1);
      expect(
        results.filter((r) => 'idempotent' in r && r.idempotent),
      ).toHaveLength(2);
      expect(JSON.stringify(results)).not.toContain(passwordHash);
    },
  );
  it.each(['role', 'event', 'notification', 'session', 'application'] as const)(
    'rolls back account, role, application and session on %s failure',
    async (where) => {
      const h = harness('TRAINEE');
      if (where === 'session')
        h.repo.revokeApplicantSessions.mockRejectedValueOnce(
          Error('transaction failed'),
        );
      if (where === 'application')
        h.app.update = jest
          .fn()
          .mockRejectedValueOnce(Error('transaction failed'))
          .mockImplementation((v: any) => Object.assign(h.app, v));
      if (where === 'role')
        h.roles.asignRoleToUser.mockRejectedValueOnce(
          Error('transaction failed'),
        );
      if (where === 'event')
        h.repo.event.mockRejectedValueOnce(Error('transaction failed'));
      if (where === 'notification')
        h.welcome.enqueue.mockRejectedValueOnce(Error('transaction failed'));
      await expect(h.approve()).rejects.toThrow('transaction failed');
      expect(h.state.users).toEqual([]);
      expect(h.state.roles).toEqual([]);
      expect(h.state.notices).toEqual([]);
      expect(h.state.revoked).toBe(false);
      expect(h.app.status).toBe('PENDING_REVIEW');
      await h.approve();
      expect(h.state.users).toHaveLength(1);
    },
  );
  it('rejects a conflicting regular account without changing its password', async () => {
    const h = harness('TRAINEE');
    h.state.users.push({ id: randomUUID(), passwordHash: 'existing-password' });
    await expect(h.approve()).rejects.toThrow('Identity already exists');
    expect(h.state.users).toEqual([
      expect.objectContaining({ passwordHash: 'existing-password' }),
    ]);
    expect(h.userRepo.create).not.toHaveBeenCalled();
    expect(h.state.revoked).toBe(false);
  });
  it('maps a database unique-identity race to a generic conflict and rolls back', async () => {
    const h = harness('TRAINEE');
    h.userRepo.create.mockRejectedValueOnce({
      name: 'SequelizeUniqueConstraintError',
      sql: 'private SQL',
    });
    await expect(h.approve()).rejects.toThrow('national ID already exists');
    expect(h.state.users).toEqual([]);
    expect(h.state.roles).toEqual([]);
    expect(h.state.revoked).toBe(false);
    expect(h.app.status).toBe('PENDING_REVIEW');
  });
  it('rejects malformed stored hashes without creating an account', async () => {
    const h = harness('TRAINEE');
    h.repo.approvalCredential.mockResolvedValueOnce({
      passwordHash: 'not-argon2',
      loginEmail: 'family@example.test',
    });
    await expect(h.approve()).rejects.toThrow(
      'Applicant credential is invalid',
    );
    expect(h.userRepo.create).not.toHaveBeenCalled();
  });
  it('never reissues a recovery code for a password application', async () => {
    const h = harness('TRAINEE');
    h.app.status = 'DRAFT';
    (h.repo as any).sessionForReissue = async () => ({ update: jest.fn() });
    await expect(
      h.service.reissueRecoveryCode(h.actor, h.id, true),
    ).rejects.toThrow('do not use recovery codes');
  });
  it.each(['TRAINEE', 'VOLUNTEER'] as const)(
    '%s legacy approval still generates a temporary password',
    async (type) => {
      const h = harness(type, true),
        result = await h.approve();
      expect(result.temporaryPassword).toHaveLength(18);
      expect(h.state.users[0].mustChangePassword).toBe(true);
      expect(h.state.users[0].temporaryPasswordExpiresAt).not.toBeNull();
      expect(h.state.revoked).toBe(false);
      expect(h.state.notices[0]).not.toHaveProperty('notificationOnly');
    },
  );
  it('rejects password applicant login after approval even when the public flow is enabled later', async () => {
    const h = harness('TRAINEE');
    await h.approve();
    Object.assign(process.env, {
      NODE_ENV: 'development',
      ETLAASOT_RUNTIME_TARGET: 'development',
      BRANCH_NAME: 'dev',
      APPLICANT_PASSWORD_AUTH_ENABLED: 'true',
      APPLICANT_REGISTRATION_ENABLED: 'true',
      PARENT_ADMISSION_SCHEMA_READY: 'true',
      SUPABASE_URL: 'https://vlysppqfozfiwcmsyban.supabase.co',
      DB_USER: 'etlaasot_app.vlysppqfozfiwcmsyban',
      DB_HOST: 'aws-0-eu-central-1.pooler.supabase.com',
      DB_PORT: '5432',
      DB_NAME: 'postgres',
      DB_SSL: 'true',
      DB_SSL_REJECT_UNAUTHORIZED: 'true',
      DB_SYNC: 'false',
      DB_LOGGING: 'false',
    });
    delete process.env.RAILWAY_PROJECT_ID;
    delete process.env.RAILWAY_ENVIRONMENT_ID;
    delete process.env.RAILWAY_SERVICE_ID;
    const credentials = {
      find: async () => ({ applicationId: h.id, passwordHash }),
      lockSession: jest.fn(),
      hasUser: async () => true,
      session: jest.fn(),
    };
    const login = new ApplicationCredentialsService(
      credentials as never,
      h.repo as never,
    );
    await expect(
      login.login({ identifier: '123456782', password }),
    ).rejects.toThrow('Invalid credentials');
    expect(credentials.session).not.toHaveBeenCalled();
  });
});
