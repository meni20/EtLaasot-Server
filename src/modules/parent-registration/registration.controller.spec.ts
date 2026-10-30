import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  RegistrationController,
  ActivityYearController,
} from './registration.controller';
import {
  RegistrationErrorInterceptor,
  RegistrationFeatureGuard,
} from './registration.guard';
import { RegistrationService } from './registration.service';

describe('Parent registration HTTP boundary (offline)', () => {
  let app: INestApplication, oldFlag: string | undefined;
  const me = randomUUID();
  const actor = { userId: me, roles: [{ roleId: 2 }] };
  const service = {
    status: jest.fn(),
    me: jest.fn(),
    saveDraft: jest.fn(),
    submit: jest.fn(),
    feedback: jest.fn(),
    years: jest.fn(),
    openPeriod: jest.fn(),
    list: jest.fn(),
    detail: jest.fn(),
    approve: jest.fn(),
    requestChanges: jest.fn(),
    renew: jest.fn(),
  };
  beforeAll(async () => {
    oldFlag = process.env.PARENT_REGISTRATION_ENABLED;
    process.env.PARENT_REGISTRATION_ENABLED = 'true';
    const module = await Test.createTestingModule({
      controllers: [RegistrationController, ActivityYearController],
      providers: [
        RegistrationFeatureGuard,
        RegistrationErrorInterceptor,
        { provide: RegistrationService, useValue: service },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: any) {
          const req = context.switchToHttp().getRequest();
          if (!req.headers.authorization && !req.headers.cookie)
            throw new UnauthorizedException();
          req.user = actor;
          return true;
        },
      })
      .compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });
  beforeEach(() => {
    jest.resetAllMocks();
    service.status.mockResolvedValue({ accessBlocked: false });
    service.saveDraft.mockResolvedValue({ revision: 1 });
  });
  afterAll(async () => {
    await app.close();
    if (oldFlag === undefined) delete process.env.PARENT_REGISTRATION_ENABLED;
    else process.env.PARENT_REGISTRATION_ENABLED = oldFlag;
  });
  it('requires the existing JWT boundary', () =>
    request(app.getHttpServer()).get('/parent-registration/me').expect(401));
  it('returns 404 with the feature flag disabled', async () => {
    process.env.PARENT_REGISTRATION_ENABLED = 'false';
    try {
      await request(app.getHttpServer())
        .get('/parent-registration/me')
        .set('Authorization', 'Bearer fictional')
        .expect(404);
      expect(service.me).not.toHaveBeenCalled();
    } finally {
      process.env.PARENT_REGISTRATION_ENABLED = 'true';
    }
  });
  it('uses JWT identity and no-store responses', async () => {
    await request(app.getHttpServer())
      .get('/parent-registration/me/status')
      .set('Authorization', 'Bearer fictional')
      .expect('Cache-Control', 'private, no-store')
      .expect(200);
    expect(service.status).toHaveBeenCalledWith(actor);
  });
  it('rejects supplied trainee identity and server-owned status fields', async () => {
    await request(app.getHttpServer())
      .patch('/parent-registration/me/draft')
      .set('Authorization', 'Bearer fictional')
      .send({
        revision: 0,
        currentStep: 1,
        data: {},
        traineeUuid: randomUUID(),
        status: 'APPROVED',
      })
      .expect(400);
    expect(service.saveDraft).not.toHaveBeenCalled();
  });
  it('validates revisions, stages, and administrative UUID paths', async () => {
    await request(app.getHttpServer())
      .patch('/parent-registration/me/draft')
      .set('Authorization', 'Bearer fictional')
      .send({ revision: -1, currentStep: 6, data: {} })
      .expect(400);
    await request(app.getHttpServer())
      .get('/parent-registration/admin/forms/not-a-uuid')
      .set('Authorization', 'Bearer fictional')
      .expect(400);
  });
  it('requires trusted origins for cookie mutations', async () => {
    await request(app.getHttpServer())
      .patch('/parent-registration/me/draft')
      .set('Cookie', 'access_token=fictional')
      .set('Origin', 'https://untrusted.invalid')
      .send({ revision: 0, currentStep: 1, data: {} })
      .expect(403);
    await request(app.getHttpServer())
      .patch('/parent-registration/me/draft')
      .set('Authorization', 'Bearer fictional')
      .send({ revision: 0, currentStep: 1, data: {} })
      .expect(200);
    expect(service.saveDraft).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ revision: 0 }),
    );
  });
  it('does not leak SQL error details or bound medical data', async () => {
    service.status.mockRejectedValue(
      new Error('SQL bind medical secret 123456782'),
    );
    const result = await request(app.getHttpServer())
      .get('/parent-registration/me/status')
      .set('Authorization', 'Bearer fictional')
      .expect(503);
    expect(JSON.stringify(result.body)).not.toMatch(
      /123456782|medical secret|SQL bind/,
    );
  });
  it('caps request bodies using the existing default JSON parser', async () => {
    await request(app.getHttpServer())
      .patch('/parent-registration/me/draft')
      .set('Authorization', 'Bearer fictional')
      .send({
        revision: 0,
        currentStep: 1,
        data: { value: 'x'.repeat(110000) },
      })
      .expect(413);
  });
  it('exposes no fake document mutation route', () =>
    request(app.getHttpServer())
      .post('/parent-registration/admin/documents')
      .set('Authorization', 'Bearer fictional')
      .send({})
      .expect(404));
  it('rejects implicit string booleans on administrator renewal', async () => {
    await request(app.getHttpServer())
      .post(`/parent-registration/admin/trainees/${me}/renew`)
      .set('Authorization', 'Bearer fictional')
      .send({
        reason: 'Fictional renewal',
        branchId: 'a',
        activityYearId: randomUUID(),
        blocksAccess: 'false',
      })
      .expect(400);
    expect(service.renew).not.toHaveBeenCalled();
  });
});
