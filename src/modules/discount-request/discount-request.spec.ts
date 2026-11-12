import {
  ConflictException,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthorizationService } from '../auth/authorization.service';
import type { AuthUser } from '../auth/authorization.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TraineeDocumentStorageService } from '../storage/trainee-document-storage.service';
import User from '../user/entities/user.entity';
import {
  DiscountAdminController,
  DiscountRequestGuard,
  DiscountSelfController,
} from './discount-request.controller';
import { DiscountRequestPdfService } from './discount-request-pdf.service';
import { DiscountRequestRepository } from './discount-request.repository';
import type { DiscountRow } from './discount-request.repository';
import { DiscountRequestService } from './discount-request.service';
import { requiredDocuments } from './discount-form';
import { discountRequestModules } from './discount-request.module';

const mine = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const outside = '33333333-3333-4333-8333-333333333333';
const actors: Record<string, AuthUser> = {
  trainee: { userId: mine, roles: [{ roleId: 2, branchId: 'a' }] },
  other: { userId: other, roles: [{ roleId: 2, branchId: 'a' }] },
  volunteer: {
    userId: mine,
    roles: [
      { roleId: 1, branchId: 'a' },
      { roleId: 2, branchId: 'a' },
    ],
  },
  manager: {
    userId: outside,
    roles: [
      { roleId: 10000, branchId: 'a' },
      { roleId: 1, branchId: 'b' },
    ],
  },
  super: { userId: outside, roles: [{ roleId: 10001 }] },
};
const self = '/user/me/discount-request';
const admin = (id: string) => '/trainee/' + id + '/discount-request';
const signature =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nnoAAAAASUVORK5CYII=';
const answers = {
  traineeName: 'חניך בדיקה',
  traineeSchool: 'בית ספר',
  traineeClass: 'ה',
  traineeId: '123456782',
  traineeBranch: 'סניף א',
  address: 'כתובת בדיקה',
  trainee2Included: 'no',
  trainee3Included: 'no',
  marital: 'divorced',
  fatherEmployment: 'na',
  motherEmployment: 'unemployed',
  motherName: 'אם בדיקה',
  motherId: '123456782',
  motherPhone: '0501234567',
  motherBenefit: 'no',
  home: 'no',
  business: 'no',
  vehicle: 'no',
  municipal: 'no',
  reasons: 'נימוקים לבדיקה בלבד',
  signer: 'אם בדיקה',
};
const pdf = Buffer.from('%PDF-1.4\nFictional evidence\n%%EOF');

describe('private discount request routes', () => {
  let app: INestApplication;
  const rows = new Map<string, DiscountRow>();
  const files = new Map<string, Buffer>();
  let sequence = 0;
  const render = jest.fn(async (_payload: object) => pdf);
  const repository = {
    find: async (id: string) => rows.get(id),
    prefill: async () => ({ traineeSchool: 'בית ספר' }),
    draftData: (row: DiscountRow) => row.data,
    enable: async (id: string) => {
      if (!rows.has(id))
        rows.set(id, {
          revision: 0,
          data: {},
          attachments: {},
          submittedAt: null,
          evidence: null,
        });
    },
    update: async (
      id: string,
      revision: number,
      change: Partial<DiscountRow>,
    ) => {
      const row = rows.get(id);
      if (!row || row.submittedAt || row.revision !== revision)
        throw new ConflictException();
      rows.set(id, { ...row, ...change, revision: revision + 1 });
      return { revision: revision + 1 };
    },
  };
  const http = (
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    actor: string,
  ) =>
    request(app.getHttpServer())
      [method](path)
      .set('Authorization', 'Bearer ' + actor)
      .set('X-Discount-Request', '1');

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [DiscountSelfController, DiscountAdminController],
      providers: [
        AuthorizationService,
        DiscountRequestGuard,
        DiscountRequestService,
        { provide: DiscountRequestRepository, useValue: repository },
        { provide: DiscountRequestPdfService, useValue: { render } },
        {
          provide: TraineeDocumentStorageService,
          useValue: {
            buildDiscountPath: (id: string, extension: string) =>
              `discount/${id}/${++sequence}.${extension}`,
            upload: async (path: string, bytes: Buffer) => {
              files.set(path, bytes);
            },
            remove: async (path: string) => {
              files.delete(path);
            },
            downloadDiscount: async (path: string) => files.get(path),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context) {
          const req = context.switchToHttp().getRequest();
          const actor = actors[req.headers.authorization?.slice(7)];
          if (!actor) throw new UnauthorizedException();
          req.user = actor;
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    rows.clear();
    files.clear();
    render.mockClear();
    jest.spyOn(User, 'findByPk').mockImplementation(
      async (id) =>
        ({
          id,
          name: 'חניך בדיקה',
          parentName: 'אם בדיקה',
          address: 'כתובת בדיקה',
          branchId: id === outside ? 'b' : 'a',
          branch: { name: 'סניף א' },
          isActive: true,
          userRoles: [{ roleId: 2, resourceId: 'a' }],
        }) as User,
    );
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => app.close());

  it('requires an individual grant, enforces the primary branch, and hides the feature from volunteers', async () => {
    await request(app.getHttpServer())
      .get(self + '/status')
      .expect(401);
    await http('get', self + '/status', 'trainee').expect(404);
    await http('put', admin(outside) + '/enable', 'manager').expect(403);
    await http('put', admin(outside) + '/enable', 'super').expect(200);
    await request(app.getHttpServer())
      .put(admin(mine) + '/enable')
      .set('Authorization', 'Bearer manager')
      .expect(403);
    await http('put', admin(mine) + '/enable', 'manager').expect(200, {
      status: 'enabled',
    });
    await http('put', admin(mine) + '/enable', 'manager').expect(200, {
      status: 'enabled',
    });
    await http('get', self + '/status', 'other').expect(404);
    await http('get', self + '/draft', 'volunteer').expect(404);
    await http('get', self + '/draft?traineeId=' + outside, 'trainee')
      .expect(200)
      .expect('Cache-Control', 'private, no-store')
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          traineeName: 'חניך בדיקה',
          signer: 'אם בדיקה',
          traineeBranch: 'סניף א',
        });
        expect(body.revision).toBe(0);
      });
  });

  it('resumes drafts, requires documents and signature, and exposes immutable evidence only to managers', async () => {
    await http('put', admin(mine) + '/enable', 'manager').expect(200);
    await http('put', self + '/draft', 'trainee')
      .send({ revision: 0, data: answers })
      .expect(200, { revision: 1 });
    await http('get', admin(mine), 'manager').expect(200, { status: 'draft' });
    await http('get', self + '/draft', 'trainee')
      .expect(200)
      .expect(({ body }) => expect(body.data.reasons).toBe(answers.reasons));
    await http('post', self + '/submit', 'trainee')
      .send({ revision: 1, data: answers, declared: true, signature })
      .expect(400);
    let revision = 1;
    for (const document of requiredDocuments(answers)) {
      await http(
        'put',
        self + '/attachments/' + document.key + '?revision=' + revision,
        'trainee',
      )
        .attach('file', pdf, {
          filename: document.key + '.pdf',
          contentType: 'application/pdf',
        })
        .expect(200);
      revision++;
    }
    expect(files.size).toBe(2);
    await http('get', admin(mine) + '/files/motherIdCopy', 'manager').expect(
      404,
    );
    await http('post', self + '/submit', 'trainee')
      .send({ revision, data: answers, declared: false, signature })
      .expect(400);
    await http('post', self + '/submit', 'trainee')
      .send({ revision, data: answers, declared: true, signature: 'invalid' })
      .expect(400);
    expect(render).not.toHaveBeenCalled();
    const body = { revision, data: answers, declared: true, signature };
    await Promise.all(
      [1, 2].map(() =>
        http('post', self + '/submit', 'trainee')
          .send(body)
          .expect(200, { status: 'submitted' }),
      ),
    );
    expect(files.size).toBe(4);
    expect(rows.get(mine)?.revision).toBe(revision + 1);
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({
        signature,
        sections: expect.arrayContaining([
          expect.objectContaining({
            rows: expect.arrayContaining([
              { label: 'נימוקים לבקשה', value: answers.reasons },
            ]),
          }),
        ]),
      }),
    );
    await http('get', self + '/status', 'trainee').expect(200, {
      status: 'submitted',
    });
    await http('get', self + '/draft', 'trainee').expect(404);
    await http('put', self + '/draft', 'trainee')
      .send(body)
      .expect(404);
    await http(
      'delete',
      self + '/attachments/motherIdCopy?revision=' + (revision + 1),
      'trainee',
    ).expect(404);
    await http('get', self + '/files/pdf', 'trainee').expect(404);
    await http('get', admin(mine) + '/files/pdf', 'trainee').expect(403);
    await http('get', admin(mine) + '/files/pdf', 'manager')
      .expect(200)
      .expect('Content-Type', 'application/pdf')
      .expect('Cache-Control', 'private, no-store');
    await http('get', admin(mine) + '/files/signature', 'super')
      .expect(200)
      .expect('Content-Type', 'image/png');
    await http('get', admin(mine) + '/files/motherIdCopy', 'manager').expect(
      200,
    );
    await http('get', admin(mine) + '/files/unknown', 'manager').expect(404);
  });

  it('keeps the form absent from production and derives each parent’s required supporting documents', () => {
    expect(
      discountRequestModules({
        ETLAASOT_RUNTIME_TARGET: 'production',
        ETLAASOT_GIT_BRANCH: 'main',
      }),
    ).toEqual([]);
    const documents = requiredDocuments({
      ...answers,
      fatherEmployment: 'working',
      fatherBenefit: 'yes',
      municipal: 'yes',
    });
    expect(documents.map(({ key }) => key)).toEqual([
      'fatherIdCopy',
      'fatherBenefitProof',
      'fatherPayslip1',
      'fatherPayslip2',
      'fatherPayslip3',
      'motherIdCopy',
      'motherUnemployed',
      'municipalProof',
    ]);
  });
});
