import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  ApplicationCredentialsController,
  ApplicantPasswordGuard,
} from './application-credentials.controller';
import { ApplicationCredentialsService } from './application-credentials.service';
import { AdmissionRateLimiter, admissionHash } from './admission.security';
import { RegistrationErrorInterceptor } from '../parent-registration/registration.guard';
import { JwtStrategy } from '../auth/jwt.strategy';

describe('Applicant password HTTP boundary (offline)', () => {
  const original = { ...process.env },
    origin = 'http://localhost:5174';
  let app: INestApplication, service: any, db: any;
  let counts: Map<string, number>;
  const body = {
    identifier: '123456782',
    email: 'parent@example.com',
    password: 'Applicant!2345',
    passwordConfirmation: 'Applicant!2345',
    registrationType: 'TRAINEE',
  };
  beforeAll(async () => {
    service = {
      signup: jest.fn(async () => ({
        token: 't'.repeat(43),
        expiresAt: new Date(),
      })),
      login: jest.fn(async () => ({
        token: 't'.repeat(43),
        expiresAt: new Date(),
      })),
    };
    db = {
      query: jest.fn(async (_sql: string, options: any) => {
        const key = options.replacements.key;
        const attempts = (counts.get(key) ?? 0) + 1;
        counts.set(key, attempts);
        return [{ attempts }];
      }),
    };
    const module = await Test.createTestingModule({
      controllers: [ApplicationCredentialsController],
      providers: [
        ApplicantPasswordGuard,
        RegistrationErrorInterceptor,
        { provide: ApplicationCredentialsService, useValue: service },
        {
          provide: AdmissionRateLimiter,
          useValue: new AdmissionRateLimiter(db),
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });
  beforeEach(() => {
    Object.assign(process.env, {
      NODE_ENV: 'development',
      ETLAASOT_RUNTIME_TARGET: 'development',
      BRANCH_NAME: 'dev',
      APPLICANT_PASSWORD_AUTH_ENABLED: 'true',
      APPLICATION_CREDENTIALS_SCHEMA_READY: 'true',
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
      COOKIE_CROSS_SITE: 'false',
      NATIONAL_ID_HASH_SECRET: 'fictional-http-key',
      PARENT_REGISTRATION_TOKEN_PEPPER: 'b'.repeat(64),
      CORS_ORIGINS: origin,
    });
    delete process.env.RAILWAY_PROJECT_ID;
    delete process.env.RAILWAY_ENVIRONMENT_ID;
    delete process.env.RAILWAY_SERVICE_ID;
    counts = new Map();
    jest.clearAllMocks();
  });
  afterEach(() => {
    process.env = { ...original };
  });
  afterAll(async () => {
    await app.close();
  });

  it.each(['signup', 'login'])(
    'returns 404 for disabled %s before rate limiting or service work',
    async (path) => {
      delete process.env.APPLICANT_PASSWORD_AUTH_ENABLED;
      await request(app.getHttpServer())
        .post(`/parent-applications/password/${path}`)
        .set('Origin', origin)
        .send(body)
        .expect(404);
      expect(service.signup).not.toHaveBeenCalled();
      expect(service.login).not.toHaveBeenCalled();
      expect(db.query).not.toHaveBeenCalled();
    },
  );
  it('requires an Origin even with a supplied session header', async () => {
    await request(app.getHttpServer())
      .post('/parent-applications/password/signup')
      .set('X-Applicant-Session', 't'.repeat(43))
      .send(body)
      .expect(403);
    await request(app.getHttpServer())
      .post('/parent-applications/password/signup')
      .set('Origin', 'https://hostile.invalid')
      .send(body)
      .expect(403);
    expect(service.signup).not.toHaveBeenCalled();
  });
  it('issues only a scoped applicant cookie and excludes sensitive fields', async () => {
    const result = await request(app.getHttpServer())
      .post('/parent-applications/password/signup')
      .set('Origin', origin)
      .send(body)
      .expect(201);
    expect(Object.keys(result.body).sort()).toEqual([
      'expiresAt',
      'sessionToken',
    ]);
    expect(result.headers['cache-control']).toContain('no-store');
    const cookie = String(result.headers['set-cookie']);
    expect(cookie).toContain('parent_applicant=');
    expect(cookie).toContain('Path=/parent-applications');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).not.toContain('access_token');
    expect(JSON.stringify(result.body)).not.toContain(body.password);
  });
  it.each([
    { password: 12345678 },
    { passwordConfirmation: 12345678 },
    { identifier: 123456782 },
    { email: true },
    { registrationType: 'ADMIN' },
    { password: 'x'.repeat(129) },
    { mustChangePassword: false },
    { passwordHash: '$argon2id$fake' },
  ])('rejects invalid types/lengths and privileged input %j', async (patch) => {
    await request(app.getHttpServer())
      .post('/parent-applications/password/signup')
      .set('Origin', origin)
      .send({ ...body, ...patch })
      .expect(400);
    expect(service.signup).not.toHaveBeenCalled();
  });
  it('applies shared per-identity rate limits before password verification', async () => {
    for (let i = 0; i < 8; i++)
      await request(app.getHttpServer())
        .post('/parent-applications/password/login')
        .set('Origin', origin)
        .send({ identifier: body.identifier, password: body.password })
        .expect(201);
    await request(app.getHttpServer())
      .post('/parent-applications/password/login')
      .set('Origin', origin)
      .send({ identifier: body.identifier, password: body.password })
      .expect(429);
    expect(service.login).toHaveBeenCalledTimes(8);
    expect(
      db.query.mock.calls.every(([, options]) => options.logging === false),
    ).toBe(true);
    expect(JSON.stringify(db.query.mock.calls)).not.toContain(body.identifier);
    expect(JSON.stringify(db.query.mock.calls)).not.toContain(body.password);
  });
  it('counts invalid input and does not trust a forwarded IP', async () => {
    for (let i = 0; i < 30; i++)
      await request(app.getHttpServer())
        .post('/parent-applications/password/login')
        .set('Origin', origin)
        .set('X-Forwarded-For', `192.0.2.${i}`)
        .send({ identifier: 'invalid', password: 'bad' })
        .expect(400);
    await request(app.getHttpServer())
      .post('/parent-applications/password/login')
      .set('Origin', origin)
      .send({ identifier: 'invalid', password: 'bad' })
      .expect(429);
    expect(service.login).not.toHaveBeenCalled();
  });
  it('fails closed when rate-limit persistence is unavailable', async () => {
    db.query.mockRejectedValueOnce(new Error('offline'));
    await request(app.getHttpServer())
      .post('/parent-applications/password/signup')
      .set('Origin', origin)
      .send(body)
      .expect(503);
    expect(service.signup).not.toHaveBeenCalled();
  });
  it('cannot authenticate regular routes using the applicant cookie', () => {
    process.env.JWT_SECRET = 'fictional-jwt-key';
    const strategy = new JwtStrategy({ getMe: jest.fn() } as any);
    const extractor = (strategy as any)._jwtFromRequest;
    expect(
      extractor({ headers: { cookie: `parent_applicant=${'t'.repeat(43)}` } }),
    ).toBeNull();
    expect(admissionHash('session', 't'.repeat(43))).toHaveLength(64);
  });
});
