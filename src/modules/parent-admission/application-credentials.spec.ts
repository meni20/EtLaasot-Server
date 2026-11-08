import { randomUUID } from 'crypto';
import { ApplicationCredentialsService } from './application-credentials.service';
import { ApplicationCredentialsRepository } from './application-credentials.repository';
import { normalizeApplicantEmail } from './application-credentials.dto';
import { assertApplicantPasswordFeature } from './application-credentials.feature';
import { verifyPassword } from '../auth/password.util';
import { credentialHash } from './admission.security';

const original = { ...process.env };
export function enableApplicantPasswordTestEnvironment() {
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
    SUPABASE_URL: 'https://vlysppqfozfiwcmsyban.supabase.co',
    DB_USER: 'etlaasot_app.vlysppqfozfiwcmsyban',
    DB_HOST: 'aws-0-eu-central-1.pooler.supabase.com',
    DB_PORT: '5432',
    DB_NAME: 'postgres',
    DB_SSL: 'true',
    DB_SSL_REJECT_UNAUTHORIZED: 'true',
    NATIONAL_ID_HASH_SECRET: 'fictional-offline-id-key',
    NATIONAL_ID_ENCRYPTION_KEY: 'a'.repeat(64),
    PARENT_REGISTRATION_TOKEN_PEPPER: 'b'.repeat(64),
  });
  delete process.env.RAILWAY_PROJECT_ID;
  delete process.env.RAILWAY_ENVIRONMENT_ID;
  delete process.env.RAILWAY_SERVICE_ID;
}

describe('Applicant password infrastructure (offline; no database or SMTP)', () => {
  let service: ApplicationCredentialsService, repo: any, apps: any, state: any;
  const input = {
    identifier: '123456782',
    email: ' Family@Example.COM ',
    password: 'Applicant!2345',
    passwordConfirmation: 'Applicant!2345',
    registrationType: 'TRAINEE' as const,
  };

  beforeEach(() => {
    enableApplicantPasswordTestEnvironment();
    state = {
      credentials: [],
      applications: [],
      sessions: [],
      events: [],
      users: [],
    };
    // Deterministic transactional contract harness: serialize transactions and
    // restore state on failure. Real PostgreSQL lock/trigger tests are separate.
    let tail = Promise.resolve();
    apps = {
      transaction: jest.fn((work) => {
        const result = tail.then(async () => {
          const before = structuredClone(state);
          try {
            return await work({});
          } catch (error) {
            state = before;
            throw error;
          }
        });
        tail = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      }),
      create: jest.fn(async (values) => {
        const row = { id: randomUUID(), ...values };
        state.applications.push(row);
        return row;
      }),
      application: jest.fn(async (id) => {
        const row = state.applications.find((a) => a.id === id);
        if (row.deletionRequestedAt) throw new Error('Deletion pending');
        return row;
      }),
      event: jest.fn(async (id, action) => {
        state.events.push({ id, action });
      }),
    };
    repo = {
      lockIdentity: jest.fn(async () => {}),
      lockSession: jest.fn(async () => {}),
      identityUnavailable: jest.fn(
        async (hash) =>
          state.users.includes(hash) ||
          state.applications.some((a) => a.nationalIdHash === hash),
      ),
      create: jest.fn(async (credential) => {
        state.credentials.push(credential);
      }),
      find: jest.fn(async (hash) =>
        state.credentials.find((c) => c.nationalIdHash === hash),
      ),
      hasUser: jest.fn(async (hash) => state.users.includes(hash)),
      session: jest.fn(async (id, hash, expiresAt) => {
        state.sessions = [{ applicationId: id, tokenHash: hash, expiresAt }];
      }),
    };
    service = new ApplicationCredentialsService(repo, apps);
  });
  afterEach(() => {
    process.env = { ...original };
  });

  it.each(['TRAINEE', 'VOLUNTEER'] as const)(
    'creates %s credentials and an isolated session without a recovery code',
    async (registrationType) => {
      const result = await service.signup({ ...input, registrationType });
      expect(Object.keys(result).sort()).toEqual(['expiresAt', 'token']);
      expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(result.token.split('.')).toHaveLength(1);
      const stored = state.credentials[0];
      expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
      expect(await verifyPassword(stored.passwordHash, input.password)).toBe(
        true,
      );
      expect(await verifyPassword(stored.passwordHash, 'WrongPassword')).toBe(
        false,
      );
      expect(stored.loginEmail).toBe('family@example.com');
      expect(state.applications[0]).toMatchObject({
        branchId: null,
        status: 'DRAFT',
        registrationType,
      });
      expect(state.applications[0].draftData).not.toHaveProperty('password');
      expect(JSON.stringify(state)).not.toContain(input.password);
      expect(JSON.stringify(state)).not.toContain(result.token);
      expect(state.sessions[0].tokenHash).toBe(
        credentialHash('session', result.token),
      );
      expect(repo.lockIdentity).toHaveBeenCalled();
    },
  );

  it('lets two applicants share an email while retaining separate credentials', async () => {
    await service.signup(input);
    await service.signup({ ...input, identifier: '000000018' });
    expect(state.credentials).toHaveLength(2);
    expect(state.credentials.map((c) => c.loginEmail)).toEqual([
      'family@example.com',
      'family@example.com',
    ]);
    expect(state.credentials[0].applicationId).not.toBe(
      state.credentials[1].applicationId,
    );
  });

  it.each(['123456', 'short', '123456782', 'x'.repeat(129)])(
    'rejects policy-invalid passwords',
    async (password) => {
      await expect(
        service.signup({ ...input, password, passwordConfirmation: password }),
      ).rejects.toThrow();
      expect(apps.transaction).not.toHaveBeenCalled();
    },
  );
  it('rejects a confirmation mismatch before any writes', async () => {
    await expect(
      service.signup({ ...input, passwordConfirmation: 'different' }),
    ).rejects.toThrow('confirmation');
    expect(apps.create).not.toHaveBeenCalled();
  });
  it('does not silently change a password before future regular-account login', async () => {
    const password = ` ${input.password} `;
    await expect(
      service.signup({ ...input, password, passwordConfirmation: password }),
    ).rejects.toThrow('whitespace');
    expect(apps.create).not.toHaveBeenCalled();
  });
  it.each([
    'invalid',
    'a@example.com\r\nBcc:x@example.com',
    '',
    'x'.repeat(255),
  ])('rejects malformed email', async (email) => {
    await expect(service.signup({ ...input, email })).rejects.toThrow('email');
    expect(apps.create).not.toHaveBeenCalled();
  });
  it('normalizes email without removing family aliases', () => {
    expect(normalizeApplicantEmail(' Parent+Child@Example.COM ')).toBe(
      'parent+child@example.com',
    );
  });
  it.each(['TRAINEE', 'VOLUNTEER'] as const)(
    'rejects duplicates across application types (%s)',
    async (registrationType) => {
      await service.signup(input);
      await expect(
        service.signup({ ...input, registrationType }),
      ).rejects.toThrow('Unable to register');
      expect(state.credentials).toHaveLength(1);
    },
  );
  it('refuses an existing user, including an inactive/archived identity', async () => {
    state.users.push('existing');
    repo.identityUnavailable.mockResolvedValue(true);
    await expect(service.signup(input)).rejects.toThrow('Unable to register');
    expect(state.applications).toHaveLength(0);
  });
  it('does not claim a legacy application without its ownership proof', async () => {
    repo.identityUnavailable.mockResolvedValue(true);
    await expect(service.signup(input)).rejects.toThrow('Unable to register');
    expect(repo.create).not.toHaveBeenCalled();
  });
  it('handles concurrent signup and a retry with exactly one committed identity', async () => {
    const outcomes = await Promise.allSettled([
      service.signup(input),
      service.signup(input),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(state.applications).toHaveLength(1);
    expect(state.credentials).toHaveLength(1);
    await expect(service.signup(input)).rejects.toThrow('Unable to register');
    await expect(service.login(input)).resolves.toHaveProperty('token');
  });
  it('rolls back application, credentials and session if the event fails', async () => {
    apps.event.mockRejectedValue(new Error(`unsafe ${input.password}`));
    await expect(service.signup(input)).rejects.toThrow(
      'Applicant authentication unavailable',
    );
    expect(state.applications).toHaveLength(0);
    expect(state.credentials).toHaveLength(0);
    expect(state.sessions).toHaveLength(0);
  });
  it('sanitizes uniqueness and transaction errors containing bind parameters', async () => {
    repo.create.mockRejectedValue({
      name: 'SequelizeUniqueConstraintError',
      sql: input.password,
    });
    await expect(service.signup(input)).rejects.toThrow('Unable to register');
    expect(state.applications).toHaveLength(0);
  });
  it('authenticates with the original password and rotates the applicant session', async () => {
    const first = await service.signup(input);
    const second = await service.login(input);
    expect(second.token).not.toBe(first.token);
    expect(state.sessions[0].tokenHash).toBe(
      credentialHash('session', second.token),
    );
    expect(repo.lockSession.mock.invocationCallOrder[0]).toBeLessThan(
      apps.application.mock.invocationCallOrder[0],
    );
  });
  it('returns the same failure for missing credentials and incorrect passwords', async () => {
    await expect(service.login(input)).rejects.toThrow('Invalid credentials');
    await service.signup(input);
    await expect(
      service.login({ ...input, password: 'Wrong!2345' }),
    ).rejects.toThrow('Invalid credentials');
  });
  it.each(['APPROVED', 'provisioned', 'user', 'deletion'])(
    'denies applicant login for %s without changing credentials',
    async (scenario) => {
      await service.signup(input);
      const application = state.applications[0];
      if (scenario === 'APPROVED') application.status = 'APPROVED';
      if (scenario === 'provisioned')
        application.provisionedUserId = randomUUID();
      if (scenario === 'user') repo.hasUser.mockResolvedValue(true);
      if (scenario === 'deletion') application.deletionRequestedAt = new Date();
      await expect(service.login(input)).rejects.toThrow();
      expect(state.credentials).toHaveLength(1);
    },
  );
  it('rejects a credential changed between verification and the transaction', async () => {
    await service.signup(input);
    const first = state.credentials[0];
    repo.find
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce({ ...first, passwordHash: 'changed' });
    await expect(service.login(input)).rejects.toThrow('Invalid credentials');
  });
  it.each(['DRAFT', 'CHANGES_REQUESTED', 'PENDING_REVIEW', 'REJECTED'])(
    'allows isolated status access for %s',
    async (status) => {
      await service.signup(input);
      state.applications[0].status = status;
      await expect(service.login(input)).resolves.toHaveProperty('token');
    },
  );
  it.each([
    'APPLICANT_PASSWORD_AUTH_ENABLED',
    'APPLICATION_CREDENTIALS_SCHEMA_READY',
    'APPLICANT_REGISTRATION_ENABLED',
    'PARENT_ADMISSION_SCHEMA_READY',
  ])('fails closed when %s is unset', async (flag) => {
    delete process.env[flag];
    await expect(service.signup(input)).rejects.toThrow();
    await expect(service.login(input)).rejects.toThrow();
    expect(apps.transaction).not.toHaveBeenCalled();
  });
  it.each([
    ['ETLAASOT_RUNTIME_TARGET', 'production'],
    ['NODE_ENV', 'production'],
    ['BRANCH_NAME', 'main'],
    ['SUPABASE_URL', 'https://production.invalid'],
    ['DB_USER', 'wrong-project'],
    ['DB_SYNC', 'true'],
    ['DB_LOGGING', 'true'],
    ['DB_SSL_REJECT_UNAUTHORIZED', 'false'],
  ])('rejects unsafe target %s=%s', (key, value) => {
    process.env[key] = value;
    expect(assertApplicantPasswordFeature).toThrow();
  });
});

describe('Credential repository SQL boundary', () => {
  it('uses transaction-bound identity locks and disables SQL logging', async () => {
    const db = { query: jest.fn(async (_sql: string, _options: any) => []) };
    const repo = new ApplicationCredentialsRepository(db as any);
    const transaction = {} as any;
    await repo.lockIdentity('a'.repeat(64), transaction);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
      expect.objectContaining({ transaction, logging: false }),
    );
    await repo.session(randomUUID(), 'b'.repeat(64), new Date(), transaction);
    const [sql, options] = db.query.mock.calls[1] as unknown as [string, any];
    expect(sql).toContain('NULL,NULL');
    expect(options.logging).toBe(false);
    expect(options.replacements).not.toHaveProperty('recoveryCode');
  });
});
