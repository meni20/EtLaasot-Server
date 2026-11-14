import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AUTH_ROLES } from 'src/constants/auth.constants';
import { AuthorizationService } from '../auth/authorization.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import EventController from './event.controller';
import EventService from './event.service';

describe('Event image multipart boundary', () => {
  let app: INestApplication;
  const authorization = new AuthorizationService();
  const upload = jest.fn().mockResolvedValue({ ok: true });

  beforeAll(async () => {
    jest.spyOn(authorization, 'getEventBranchId').mockResolvedValue('branch-a');
    const module = await Test.createTestingModule({
      controllers: [EventController],
      providers: [
        { provide: AuthorizationService, useValue: authorization },
        {
          provide: EventService,
          useValue: {
            uploadEventImage: upload,
            uploadCalendarMonthBackground: upload,
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context) {
          const req = context.switchToHttp().getRequest();
          req.user = {
            userId: 'test-user',
            roles: [
              {
                roleId: Number(req.headers['x-test-role']),
                branchId: 'branch-a',
              },
            ],
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    jest.restoreAllMocks();
  });

  const paths = [
    '/event/event-a/image',
    '/event/calendar-background/branch-a/2026-11/image',
  ];
  const png = Buffer.from('89504e470d0a1a0a0000000049454e44ae426082', 'hex');

  it.each(paths)('checks branch roles before parsing %s', async (path) => {
    for (const role of [AUTH_ROLES.VOLUNTEER, AUTH_ROLES.TRAINEE]) {
      await request(app.getHttpServer())
        .put(path)
        .set('x-test-role', String(role.id))
        .field('unexpected', 'field')
        .expect(403);
    }
    for (const role of [AUTH_ROLES.BRANCH_ADMIN, AUTH_ROLES.SUPER_ADMIN]) {
      await request(app.getHttpServer())
        .put(path)
        .set('x-test-role', String(role.id))
        .attach('image', png, {
          filename: 'test.png',
          contentType: 'image/png',
        })
        .expect(200);
    }
  });

  it('enforces file size and part limits and rejects a different branch', async () => {
    const admin = String(AUTH_ROLES.BRANCH_ADMIN.id);
    await request(app.getHttpServer())
      .put('/event/calendar-background/branch-b/2026-11/image')
      .set('x-test-role', admin)
      .field('unexpected', 'field')
      .expect(403);
    await request(app.getHttpServer())
      .put(paths[1])
      .set('x-test-role', admin)
      .field('unexpected', 'field')
      .expect(400);
    await request(app.getHttpServer())
      .put(paths[1])
      .set('x-test-role', admin)
      .attach('image', Buffer.alloc(5 * 1024 * 1024 + 1), 'test.png')
      .expect(413);
  });
});
