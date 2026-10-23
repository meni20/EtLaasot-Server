import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  ApplicantAdminController,
  ApplicantController,
  AdmissionFeatureGuard,
  AdmissionPublicGuard,
  LoginInitiationController,
} from './admission.controller';
import { AdmissionService } from './admission.service';
import { AdmissionRateLimiter } from './admission.security';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RegistrationErrorInterceptor } from '../parent-registration/registration.guard';

describe('Phase 4 HTTP authorization/abuse boundary (no database)', () => {
  const original = { ...process.env },
    origin = 'http://127.0.0.1:5184';
  let app: INestApplication, service: any, limits: any;
  beforeAll(async () => {
    process.env.APPLICANT_REGISTRATION_ENABLED = 'true';
    process.env.ID_FIRST_LOGIN_ENABLED = 'true';
    process.env.COOKIE_CROSS_SITE = 'false';
    process.env.CORS_ORIGINS = origin;
    service = {
      identify: jest.fn(async () => ({ next: 'PASSWORD' })),
      branches: jest.fn(async () => [
        { id: 'branch-test', name: 'Fictional', city: 'Test' },
      ]),
      start: jest.fn(async () => ({
        application: { id: 'fictional' },
        token: 't'.repeat(43),
        recoveryCode: 'r'.repeat(43),
        expiresAt: new Date(),
      })),
      me: jest.fn(async () => ({ application: { id: 'fictional' }, data: {} })),
      save: jest.fn(async () => ({ ok: true })),
      approve: jest.fn(async () => ({ ok: true })),
      list: jest.fn(async () => ({ rows: [], count: 0 })),
    };
    limits = { consume: jest.fn(async () => {}) };
    const module = await Test.createTestingModule({
      controllers: [
        LoginInitiationController,
        ApplicantController,
        ApplicantAdminController,
      ],
      providers: [
        AdmissionFeatureGuard,
        AdmissionPublicGuard,
        RegistrationErrorInterceptor,
        { provide: AdmissionService, useValue: service },
        { provide: AdmissionRateLimiter, useValue: limits },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          if (req.headers.authorization !== 'Bearer fictional-admin')
            throw new UnauthorizedException();
          req.user = {
            userId: 'fictional-admin',
            roles: [{ roleId: 10000, branchId: 'branch-test' }],
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
    process.env = original;
  });
  it('ID-first initiation returns no account data and prevents response caching', async () => {
    const result = await request(app.getHttpServer())
      .post('/auth/identify')
      .set('Origin', origin)
      .send({ identifier: '123456782' })
      .expect(201);
    expect(result.body).toEqual({ next: 'PASSWORD' });
    expect(result.headers['cache-control']).toContain('no-store');
  });
  it('checks the independent login/applicant flags before public work', async () => {
    process.env.ID_FIRST_LOGIN_ENABLED = 'false';
    await request(app.getHttpServer())
      .post('/auth/identify')
      .set('Origin', origin)
      .send({ identifier: '123456782' })
      .expect(404);
    process.env.ID_FIRST_LOGIN_ENABLED = 'true';
    process.env.APPLICANT_REGISTRATION_ENABLED = 'false';
    await request(app.getHttpServer())
      .get('/parent-applications/branches')
      .expect(404);
    process.env.APPLICANT_REGISTRATION_ENABLED = 'true';
    expect(limits.consume).not.toHaveBeenCalled();
  });
  it('rejects hostile origins and unbounded bodies before the service', async () => {
    await request(app.getHttpServer())
      .post('/parent-applications/start')
      .set('Origin', 'https://hostile.example.invalid')
      .send({ identifier: '123456782', branchId: 'branch-test' })
      .expect(403);
    await request(app.getHttpServer())
      .patch('/parent-applications/me/draft')
      .set('Origin', origin)
      .send({ data: { large: 'x'.repeat(97 * 1024) } })
      .expect(413);
    expect(service.start).not.toHaveBeenCalled();
    expect(service.save).not.toHaveBeenCalled();
  });
  it('sets scoped HttpOnly cookies and returns recovery credentials only on creation', async () => {
    const r = await request(app.getHttpServer())
      .post('/parent-applications/start')
      .set('Origin', origin)
      .send({ identifier: '123456782', branchId: 'branch-test' })
      .expect(201);
    expect(r.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(r.headers['set-cookie'][0]).toContain('Path=/parent-applications');
    expect(r.body.sessionToken).toHaveLength(43);
    const own = await request(app.getHttpServer())
      .get('/parent-applications/me')
      .set('X-Applicant-Session', 't'.repeat(43))
      .expect(200);
    expect(service.me).toHaveBeenCalledWith('t'.repeat(43));
    expect(own.body.recoveryCode).toBeUndefined();
  });
  it('does not treat an applicant credential as an administrator JWT', async () => {
    await request(app.getHttpServer())
      .post(
        '/parent-applications/admin/00000000-0000-4000-8000-000000000001/approve',
      )
      .set('X-Applicant-Session', 't'.repeat(43))
      .send({
        expectedVersionId: '00000000-0000-4000-8000-000000000002',
        identityVerified: true,
      })
      .expect(401);
    expect(service.approve).not.toHaveBeenCalled();
  });
  it('does not coerce a string into administrative verification consent', async () => {
    await request(app.getHttpServer())
      .post(
        '/parent-applications/admin/00000000-0000-4000-8000-000000000001/approve',
      )
      .set('Authorization', 'Bearer fictional-admin')
      .send({
        expectedVersionId: '00000000-0000-4000-8000-000000000002',
        identityVerified: 'false',
      })
      .expect(400);
    expect(service.approve).not.toHaveBeenCalled();
  });
  it('uses the socket peer, not an untrusted forwarded IP, for shared rate limits', async () => {
    await request(app.getHttpServer())
      .get('/parent-applications/branches')
      .set('X-Forwarded-For', '203.0.113.42')
      .expect(200);
    expect(limits.consume.mock.calls[0][1]).not.toBe('203.0.113.42');
  });
  it('attachments fail explicitly without accepting a fabricated private reference', async () => {
    await request(app.getHttpServer())
      .post('/parent-applications/me/attachments')
      .set('Origin', origin)
      .set('X-Applicant-Session', 't'.repeat(43))
      .send({ storagePath: 'invented' })
      .expect(503);
  });
  it('transforms administrator pagination query strings and rejects invalid pagination', async () => {
    await request(app.getHttpServer())
      .get('/parent-applications/admin?branchId=branch-test&page=1')
      .set('Authorization', 'Bearer fictional-admin')
      .expect(200);
    expect(service.list).toHaveBeenCalledWith(
      expect.anything(),
      'branch-test',
      1,
    );
    await request(app.getHttpServer())
      .get('/parent-applications/admin?page=invalid')
      .set('Authorization', 'Bearer fictional-admin')
      .expect(400);
  });
});
