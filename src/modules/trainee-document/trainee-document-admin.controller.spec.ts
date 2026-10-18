import {
  BadRequestException,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AUTH_ROLES } from 'src/constants/auth.constants';
import { AuthorizationService } from '../auth/authorization.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TraineeDocumentAdminController } from './trainee-document-admin.controller';
import { TraineeDocumentService } from './trainee-document.service';

describe('Admin trainee document listing', () => {
  let app: INestApplication;
  const actors = {
    admin: {
      userId: 'admin',
      roles: [{ roleId: AUTH_ROLES.BRANCH_ADMIN.id, branchId: 'branch-a' }],
    },
    super: {
      userId: 'super',
      roles: [{ roleId: AUTH_ROLES.SUPER_ADMIN.id }],
    },
    volunteer: {
      userId: 'volunteer',
      roles: [{ roleId: AUTH_ROLES.VOLUNTEER.id, branchId: 'branch-a' }],
    },
  };
  const documents = { listAdmin: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [TraineeDocumentAdminController],
      providers: [
        AuthorizationService,
        { provide: TraineeDocumentService, useValue: documents },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: any) {
          const req = context.switchToHttp().getRequest();
          const token = req.headers.authorization?.replace(/^Bearer /, '');
          if (!token || !actors[token]) throw new UnauthorizedException();
          req.user = actors[token];
          return true;
        },
      })
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
        exceptionFactory: () => new BadRequestException('Validation failed'),
      }),
    );
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    documents.listAdmin.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('scopes a branch admin to their authorized branches', async () => {
    const response = await request(app.getHttpServer())
      .get('/trainee/documents')
      .set('Authorization', 'Bearer admin')
      .expect(200);

    expect(documents.listAdmin).toHaveBeenCalledWith({
      branchIds: ['branch-a'],
      page: 1,
      pageSize: 25,
    });
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  it('allows a super admin to list all branches or select one branch', async () => {
    await request(app.getHttpServer())
      .get('/trainee/documents')
      .set('Authorization', 'Bearer super')
      .expect(200);
    expect(documents.listAdmin).toHaveBeenLastCalledWith({
      branchIds: undefined,
      page: 1,
      pageSize: 25,
    });

    await request(app.getHttpServer())
      .get('/trainee/documents?branchId=branch-b')
      .set('Authorization', 'Bearer super')
      .expect(200);
    expect(documents.listAdmin).toHaveBeenLastCalledWith({
      branchId: 'branch-b',
      branchIds: ['branch-b'],
      page: 1,
      pageSize: 25,
    });
  });

  it('rejects cross-branch admins and non-admin users', async () => {
    await request(app.getHttpServer())
      .get('/trainee/documents?branchId=branch-b')
      .set('Authorization', 'Bearer admin')
      .expect(403);
    await request(app.getHttpServer())
      .get('/trainee/documents')
      .set('Authorization', 'Bearer volunteer')
      .expect(403);
    expect(documents.listAdmin).not.toHaveBeenCalled();
  });

  it('validates filters and pagination before querying', async () => {
    await request(app.getHttpServer())
      .get(
        '/trainee/documents?documentType=ID_APPENDIX&search=%20Dana%20&page=2&pageSize=10',
      )
      .set('Authorization', 'Bearer admin')
      .expect(200);
    expect(documents.listAdmin).toHaveBeenCalledWith({
      branchIds: ['branch-a'],
      documentType: 'ID_APPENDIX',
      search: 'Dana',
      page: 2,
      pageSize: 10,
    });

    await request(app.getHttpServer())
      .get('/trainee/documents?documentType=INVALID')
      .set('Authorization', 'Bearer admin')
      .expect(400);
    await request(app.getHttpServer())
      .get('/trainee/documents?page=0&pageSize=101')
      .set('Authorization', 'Bearer admin')
      .expect(400);
  });
});
