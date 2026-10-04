import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AUTH_ROLES } from 'src/constants/auth.constants';
import { AuthorizationService } from '../auth/authorization.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import User from '../user/entities/user.entity';
import { TraineeDocumentAccessGuard } from './trainee-document-access.guard';
import { TraineeDocumentController } from './trainee-document.controller';
import { TraineeDocumentService } from './trainee-document.service';
import { MAX_DOCUMENT_SIZE } from './trainee-document.constants';

describe('Document HTTP routes and real branch authorization', () => {
  let app: INestApplication;
  const mine = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';
  const outside = '33333333-3333-4333-8333-333333333333';
  const volunteer = '44444444-4444-4444-8444-444444444444';
  const actors = {
    trainee: { userId: mine, roles: [{ roleId: 2, branchId: 'a' }] },
    volunteer: { userId: volunteer, roles: [{ roleId: 1, branchId: 'a' }] },
    admin: { userId: 'admin', roles: [{ roleId: 10000, branchId: 'a' }] },
    super: { userId: 'super', roles: [{ roleId: 10001 }] },
  };
  const documents = {
    list: jest.fn(),
    upload: jest.fn(),
    remove: jest.fn(),
    view: jest.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [TraineeDocumentController],
      providers: [
        AuthorizationService,
        TraineeDocumentAccessGuard,
        { provide: TraineeDocumentService, useValue: documents },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: any) {
          const req = context.switchToHttp().getRequest();
          const token =
            req.headers.authorization?.replace(/^Bearer /, '') ??
            (req.headers.cookie ? 'trainee' : undefined);
          if (!token || !actors[token]) throw new UnauthorizedException();
          req.user = actors[token];
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    documents.list.mockResolvedValue([]);
    documents.upload.mockResolvedValue({ id: 'doc' });
    documents.remove.mockResolvedValue({ ok: true });
    documents.view.mockResolvedValue({
      signedUrl: 'signed',
      expiresAt: 'expiry',
    });
    jest.spyOn(User, 'findByPk').mockImplementation(async (id: any) => {
      if (![mine, other, outside, volunteer].includes(id)) return null;
      return {
        id,
        isActive: id !== other,
        branchId: id === outside ? 'b' : 'a',
        userRoles: [
          {
            roleId:
              id === volunteer
                ? AUTH_ROLES.VOLUNTEER.id
                : AUTH_ROLES.TRAINEE.id,
            resourceId: id === outside ? 'b' : 'a',
          },
        ],
      } as User;
    });
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await app.close();
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/user/me/documents').expect(401);
    expect(documents.list).not.toHaveBeenCalled();
  });

  it('self-service derives owner from actor, ignoring target query parameters', async () => {
    const response = await request(app.getHttpServer())
      .get(`/user/me/documents?traineeUuid=${other}`)
      .set('Authorization', 'Bearer trainee')
      .expect(200);
    expect(documents.list).toHaveBeenCalledWith(mine);
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  it.each(['get', 'put', 'delete'] as const)(
    'denies trainee access to another trainee via %s',
    async (method) => {
      const path = `/trainee/${other}/documents${method === 'get' ? '' : '/ID_APPENDIX'}`;
      await request(app.getHttpServer())
        [method](path)
        .set('Authorization', 'Bearer trainee')
        .expect(403);
      expect(documents.list).not.toHaveBeenCalled();
      expect(documents.upload).not.toHaveBeenCalled();
      expect(documents.remove).not.toHaveBeenCalled();
    },
  );

  it('denies trainee view URLs for another trainee and volunteers in self-service', async () => {
    await request(app.getHttpServer())
      .get(`/trainee/${other}/documents/ID_APPENDIX/view`)
      .set('Authorization', 'Bearer trainee')
      .expect(403);
    await request(app.getHttpServer())
      .get('/user/me/documents')
      .set('Authorization', 'Bearer volunteer')
      .expect(403);
    expect(documents.view).not.toHaveBeenCalled();
  });

  it('allows authorized admin access to an archived trainee and super admin cross-branch access', async () => {
    await request(app.getHttpServer())
      .get(`/trainee/${other}/documents`)
      .set('Authorization', 'Bearer admin')
      .expect(200);
    expect(documents.list).toHaveBeenCalledWith(other);
    await request(app.getHttpServer())
      .get(`/trainee/${outside}/documents`)
      .set('Authorization', 'Bearer super')
      .expect(200);
    expect(documents.list).toHaveBeenCalledWith(outside);
  });

  it('rejects cross-branch admins and non-trainee targets', async () => {
    await request(app.getHttpServer())
      .get(`/trainee/${outside}/documents`)
      .set('Authorization', 'Bearer admin')
      .expect(403);
    await request(app.getHttpServer())
      .get(`/trainee/${volunteer}/documents`)
      .set('Authorization', 'Bearer super')
      .expect(403);
    expect(documents.list).not.toHaveBeenCalled();
  });

  it('preserves resource-branch authorization beyond the primary branch', async () => {
    jest.spyOn(User, 'findByPk').mockResolvedValue({
      id: outside,
      branchId: 'b',
      userRoles: [{ roleId: 2, resourceId: 'a' }],
    } as User);
    await request(app.getHttpServer())
      .get(`/trainee/${outside}/documents`)
      .set('Authorization', 'Bearer admin')
      .expect(200);
  });

  it('rejects malformed UUIDs and document types before file parsing', async () => {
    await request(app.getHttpServer())
      .get('/trainee/not-a-uuid/documents')
      .set('Authorization', 'Bearer admin')
      .expect(400);
    await request(app.getHttpServer())
      .put('/user/me/documents/INVALID')
      .set('Authorization', 'Bearer trainee')
      .attach('unexpected-field', Buffer.from('data'), 'file.pdf')
      .expect(400)
      .expect(({ body }) => expect(body.message).toBe('Invalid document type'));
    expect(documents.upload).not.toHaveBeenCalled();
  });

  it('rejects unauthorized upload before the multipart interceptor', async () => {
    await request(app.getHttpServer())
      .put(`/trainee/${outside}/documents/ID_APPENDIX`)
      .set('Authorization', 'Bearer admin')
      .attach('unexpected-field', Buffer.from('data'), 'file.pdf')
      .expect(403);
    expect(documents.upload).not.toHaveBeenCalled();
  });

  it('bounds multipart size and rejects extra fields/files', async () => {
    const path = '/user/me/documents/ID_APPENDIX';
    await request(app.getHttpServer())
      .put(path)
      .set('Authorization', 'Bearer trainee')
      .attach('file', Buffer.alloc(MAX_DOCUMENT_SIZE + 1), 'large.pdf')
      .expect(413);
    await request(app.getHttpServer())
      .put(path)
      .set('Authorization', 'Bearer trainee')
      .field('traineeUuid', other)
      .attach('file', Buffer.from('pdf'), 'file.pdf')
      .expect(400);
    await request(app.getHttpServer())
      .put(path)
      .set('Authorization', 'Bearer trainee')
      .attach('file', Buffer.from('pdf'), 'one.pdf')
      .attach('file', Buffer.from('pdf'), 'two.pdf')
      .expect(400);
    await request(app.getHttpServer())
      .put(path)
      .set('Authorization', 'Bearer trainee')
      .attach('image', Buffer.from('pdf'), 'file.pdf')
      .expect(400);
    expect(documents.upload).not.toHaveBeenCalled();
  });

  it('allows exactly the maximum file size through multipart parsing', async () => {
    await request(app.getHttpServer())
      .put('/user/me/documents/ID_APPENDIX')
      .set('Authorization', 'Bearer trainee')
      .attach('file', Buffer.alloc(MAX_DOCUMENT_SIZE), 'maximum.pdf')
      .expect(200);
    expect(documents.upload).toHaveBeenCalled();
  });

  it.each(['self', 'admin'])(
    'routes %s upload, delete and view to the authorized target',
    async (mode) => {
      const base =
        mode === 'self' ? '/user/me/documents' : `/trainee/${other}/documents`;
      const token = mode === 'self' ? 'trainee' : 'admin';
      const target = mode === 'self' ? mine : other;
      await request(app.getHttpServer())
        .put(`${base}/ID_APPENDIX`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('%PDF-1.4'), 'file.pdf')
        .expect(200);
      expect(documents.upload).toHaveBeenCalledWith(
        target,
        'ID_APPENDIX',
        expect.objectContaining({ originalname: 'file.pdf' }),
      );
      await request(app.getHttpServer())
        .delete(`${base}/ID_APPENDIX`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(documents.remove).toHaveBeenCalledWith(target, 'ID_APPENDIX');
      const response = await request(app.getHttpServer())
        .get(`${base}/ID_APPENDIX/view`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(documents.view).toHaveBeenCalledWith(target, 'ID_APPENDIX');
      expect(response.headers['cache-control']).toBe('private, no-store');
    },
  );

  it('requires trusted Origin for cookie-authenticated mutations', async () => {
    const previous = process.env.CORS_ORIGINS;
    process.env.CORS_ORIGINS = 'https://client.example';
    try {
      await request(app.getHttpServer())
        .delete('/user/me/documents/ID_APPENDIX')
        .set('Cookie', 'access_token=test')
        .set('Origin', 'https://evil.example')
        .expect(403);
      await request(app.getHttpServer())
        .delete('/user/me/documents/ID_APPENDIX')
        .set('Cookie', 'access_token=test')
        .expect(403);
      await request(app.getHttpServer())
        .delete('/user/me/documents/ID_APPENDIX')
        .set('Cookie', 'access_token=test')
        .set('Origin', 'https://client.example')
        .expect(200);
    } finally {
      if (previous === undefined) delete process.env.CORS_ORIGINS;
      else process.env.CORS_ORIGINS = previous;
    }
  });
});
