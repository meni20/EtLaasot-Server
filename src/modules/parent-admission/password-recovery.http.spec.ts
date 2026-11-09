import {
  HttpException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PasswordRecoveryController } from './password-recovery.controller';
import { PasswordRecoveryService } from './password-recovery.service';
import { ApplicantPasswordGuard } from './application-credentials.controller';
import { AdmissionRateLimiter } from './admission.security';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RegistrationErrorInterceptor } from '../parent-registration/registration.guard';
describe('Password recovery HTTP boundary (offline)', () => {
  const saved = { ...process.env },
    origin = 'http://localhost:5173';
  let app: INestApplication;
  const service = {
    request: jest.fn(async () => ({ ok: true })),
    consume: jest.fn(async () => ({ ok: true })),
    authorize: jest.fn(async () => ({ ok: true })),
  };
  const limits = { consume: jest.fn(async (..._args: unknown[]) => {}) };
  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: 'development',
      NATIONAL_ID_HASH_SECRET: 'fictional-http-recovery-secret',
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
      CORS_ORIGINS: origin,
    });
    delete process.env.RAILWAY_PROJECT_ID;
    delete process.env.RAILWAY_ENVIRONMENT_ID;
    delete process.env.RAILWAY_SERVICE_ID;
    const module = await Test.createTestingModule({
      controllers: [PasswordRecoveryController],
      providers: [
        ApplicantPasswordGuard,
        RegistrationErrorInterceptor,
        { provide: PasswordRecoveryService, useValue: service },
        { provide: AdmissionRateLimiter, useValue: limits },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const r = ctx.switchToHttp().getRequest();
          if (!r.headers.authorization)
            throw new HttpException('Unauthorized', 401);
          r.user = {
            userId: 'manager',
            roles: [{ roleId: 10000, branchId: 'a' }],
          };
          return true;
        },
      })
      .compile();
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
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => {
    await app.close();
    process.env = saved;
  });
  it('returns a generic response with no account, email or token', async () => {
    const r = await request(app.getHttpServer())
      .post('/password-recovery/request')
      .set('Origin', origin)
      .send({ identifier: '123456782' })
      .expect(201);
    expect(r.body).toEqual({ ok: true });
    expect(r.headers['cache-control']).toContain('no-store');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(limits.consume).toHaveBeenCalledWith(
      'password-reset-request',
      expect.any(String),
      expect.any(String),
    );
  });
  it('requires trusted origin and rejects malformed requests and privilege injection', async () => {
    await request(app.getHttpServer())
      .post('/password-recovery/request')
      .send({ identifier: '123456782' })
      .expect(403);
    await request(app.getHttpServer())
      .post('/password-recovery/consume')
      .set('Origin', origin)
      .send({ token: 'x', password: 'Valid!234', confirmation: 'Valid!234' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/password-recovery/request')
      .set('Origin', origin)
      .send({
        identifier: '123456782',
        emailVerified: true,
        email: 'attacker@example.test',
      })
      .expect(400);
    expect(service.request).not.toHaveBeenCalled();
  });
  it('consumes the token only through the body and enforces rate limits', async () => {
    await request(app.getHttpServer())
      .post('/password-recovery/consume')
      .set('Origin', origin)
      .send({
        token: 'x'.repeat(43),
        password: 'Valid!234',
        confirmation: 'Valid!234',
      })
      .expect(201);
    expect(service.consume).toHaveBeenCalledWith(
      'x'.repeat(43),
      'Valid!234',
      'Valid!234',
    );
    expect(limits.consume).toHaveBeenCalledWith(
      'password-reset-consume',
      expect.any(String),
      'x'.repeat(43),
    );
    limits.consume.mockRejectedValueOnce(
      new HttpException('Too many requests', 429),
    );
    await request(app.getHttpServer())
      .post('/password-recovery/request')
      .set('Origin', origin)
      .send({ identifier: '123456782' })
      .expect(429);
  });
  it('manager authorization requires JWT and strict explicit booleans', async () => {
    const body = {
      subjectType: 'USER',
      subjectId: '00000000-0000-4000-8000-000000000001',
      email: 'family@example.test',
      identityVerified: true,
      emailConfirmed: true,
    };
    await request(app.getHttpServer())
      .post('/password-recovery/authorize')
      .send(body)
      .expect(401);
    await request(app.getHttpServer())
      .post('/password-recovery/authorize')
      .set('Authorization', 'Bearer manager')
      .send({ ...body, identityVerified: 'true' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/password-recovery/authorize')
      .set('Authorization', 'Bearer manager')
      .send({ ...body, passwordHash: 'untrusted' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/password-recovery/authorize')
      .set('Authorization', 'Bearer manager')
      .send(body)
      .expect(201);
    expect(service.authorize).toHaveBeenCalledTimes(1);
  });
  it('unexpected database failures cannot expose credential data', async () => {
    service.consume.mockRejectedValueOnce({
      name: 'SequelizeDatabaseError',
      sql: 'private SQL',
      parameters: ['secret-token', '$argon2id$secret'],
    });
    const r = await request(app.getHttpServer())
      .post('/password-recovery/consume')
      .set('Origin', origin)
      .send({
        token: 'x'.repeat(43),
        password: 'Valid!234',
        confirmation: 'Valid!234',
      })
      .expect(503);
    expect(JSON.stringify(r.body)).not.toMatch(/secret|argon2id|SQL/);
  });
  it('all new public endpoints are disabled by the existing flag', async () => {
    process.env.APPLICANT_PASSWORD_AUTH_ENABLED = 'false';
    try {
      for (const route of ['request', 'consume'])
        await request(app.getHttpServer())
          .post('/password-recovery/' + route)
          .set('Origin', origin)
          .send({})
          .expect(404);
    } finally {
      process.env.APPLICANT_PASSWORD_AUTH_ENABLED = 'true';
    }
  });
});
