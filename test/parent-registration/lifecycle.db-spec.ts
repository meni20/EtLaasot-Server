// Opt-in component integration: real PostgreSQL + real repositories/services/guards.
// Never imports AppModule or any runtime/Supabase environment loader.
import 'reflect-metadata';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { Sequelize } from 'sequelize-typescript';
import { Model, QueryTypes } from 'sequelize';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
import request from 'supertest';
import User from '../../src/modules/user/entities/user.entity';
import Branch from '../../src/modules/branch/entities/branch.entity';
import UserRole from '../../src/modules/user-role/enitites/user-role.entity';
import Role from '../../src/modules/roles/enitites/roles.entity';
import Medication from '../../src/modules/trainee-medication/entities/trainee-medication.entity';
import { AuthorizationService } from '../../src/modules/auth/authorization.service';
import AuthService from '../../src/modules/auth/auth.service';
import { JwtStrategy } from '../../src/modules/auth/jwt.strategy';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { RegistrationRepository } from '../../src/modules/parent-registration/registration.repository';
import { RegistrationService } from '../../src/modules/parent-registration/registration.service';
import {
  ActivityYearController,
  RegistrationController,
} from '../../src/modules/parent-registration/registration.controller';
import {
  RegistrationErrorInterceptor,
  RegistrationFeatureGuard,
} from '../../src/modules/parent-registration/registration.guard';
import { DeferredRegistrationDocumentGenerator } from '../../src/modules/parent-registration/registration-document.generator';
import {
  ActivityYear,
  RegistrationForm,
  RegistrationFormDocument,
  RegistrationFormHistory,
  RegistrationFormVersion,
  REGISTRATION_MODELS,
} from '../../src/modules/parent-registration/entities/registration.entities';
import { fictionalRegistration } from '../../src/modules/parent-registration/registration.test-fixtures';
import {
  contentHash,
  protectData,
  readData,
} from '../../src/modules/parent-registration/registration.validation';
const {
  assertTestTarget,
  assertIsolatedServer,
  createAttestedPg,
} = require('../../scripts/parent-registration-test-safety.cjs');

describe('Parent registration isolated PostgreSQL lifecycle (approval required)', () => {
  let db: Sequelize, service: RegistrationService, app: INestApplication;
  const ids = {
    trainee: randomUUID(),
    other: randomUUID(),
    admin: randomUUID(),
    outside: randomUUID(),
    super: randomUUID(),
  };
  let yearId: string;
  const actors = {
    trainee: { userId: ids.trainee, roles: [{ roleId: 2 }] },
    other: { userId: ids.other, roles: [{ roleId: 2 }] },
    admin: {
      userId: ids.admin,
      roles: [{ roleId: 10000, resourceId: 'branch-test-a' }],
    },
    outside: {
      userId: ids.outside,
      roles: [{ roleId: 10000, resourceId: 'branch-test-b' }],
    },
    super: { userId: ids.super, roles: [{ roleId: 10001 }] },
  };
  let token: string, formId: string;
  beforeAll(async () => {
    const config = assertTestTarget();
    if (!/^[a-f0-9]{64}$/.test(process.env.PHASE2_TEST_NONCE ?? ''))
      throw new Error('Launch through the isolated test runner');
    // Independent pg preflight before Sequelize may connect.
    const { Client } = require('pg');
    const client = new Client(config);
    try {
      await client.connect();
      await assertIsolatedServer(client, config.database);
      const result = await client.query(
        'SELECT nonce FROM public.phase2_test_sandbox',
      );
      if (
        result.rows.length !== 1 ||
        result.rows[0].nonce !== process.env.PHASE2_TEST_NONCE
      )
        throw new Error('Sandbox identity mismatch');
    } finally {
      await client.end();
    }
    db = new Sequelize({
      dialect: 'postgres',
      dialectModule: createAttestedPg(config.database),
      host: config.host,
      port: config.port,
      username: config.user,
      password: config.password,
      database: config.database,
      logging: false,
      pool: { min: 0, max: 5 },
      dialectOptions: {
        ssl: false,
        application_name: 'parent-registration-isolated-tests',
      },
      hooks: {
        // Every pool connection is independently attested before ORM SQL can run.
        afterConnect: async (connection: any) => {
          await assertIsolatedServer(connection, config.database);
        },
      },
    });
    // Register existing association graph as metadata only. Never sync/create it.
    const modules = path.resolve(__dirname, '../../src/modules');
    const existing: any[] = [];
    function visit(dir: string) {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, item.name);
        if (item.isDirectory()) visit(file);
        else if (item.name.endsWith('.entity.ts')) {
          for (const exported of Object.values(require(file)))
            if (
              typeof exported === 'function' &&
              exported.prototype instanceof Model
            )
              existing.push(exported);
        }
      }
    }
    visit(modules);
    db.addModels([...new Set(existing), ...REGISTRATION_MODELS]);
    await db.authenticate();
    await Branch.bulkCreate([
      { id: 'branch-test-a', name: 'Fictional A', isActive: true },
      { id: 'branch-test-b', name: 'Fictional B', isActive: true },
    ]);
    await Role.bulkCreate([
      { id: 2, name: 'Trainee' },
      { id: 10000, name: 'Admin' },
      { id: 10001, name: 'Super' },
    ]);
    for (const [kind, id] of Object.entries(ids)) {
      const branchId =
        kind === 'other' || kind === 'outside'
          ? 'branch-test-b'
          : 'branch-test-a';
      await User.create({
        id,
        name: `Fictional ${kind}`,
        phoneNumber: '0500000000',
        branchId,
        isActive: true,
        allergies: 'Existing allergy must stay',
      });
      await UserRole.create({
        userId: id,
        roleId:
          kind === 'super'
            ? 10001
            : kind === 'admin' || kind === 'outside'
              ? 10000
              : 2,
        resourceId: branchId,
      });
    }
    await Medication.create({
      traineeUuid: ids.trainee,
      medicationName: 'Fictional pre-existing medication',
      isActive: true,
    });
    const year = await ActivityYear.create({
      name: 'Fictional test year',
      startsOn: '2000-01-01',
      endsOn: '2099-12-31',
      isActive: true,
    });
    yearId = year.id;
    service = new RegistrationService(
      new RegistrationRepository(db),
      new AuthorizationService(),
      new DeferredRegistrationDocumentGenerator(),
    );
    const module = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [ActivityYearController, RegistrationController],
      providers: [
        JwtStrategy,
        JwtAuthGuard,
        RegistrationFeatureGuard,
        RegistrationErrorInterceptor,
        { provide: RegistrationService, useValue: service },
        // Authentication resolves only the synthetic fixture actors. JWT signature,
        // extraction and mustChangePassword enforcement use production strategy/guard.
        {
          provide: AuthService,
          useValue: {
            getMe: async (id: string) => {
              const actor = Object.values(actors).find((x) => x.userId === id);
              if (!actor) throw new Error('Unknown fixture actor');
              return actor;
            },
          },
        },
      ],
    }).compile();
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
    token = new JwtService({ secret: process.env.JWT_SECRET }).sign(
      { sub: ids.trainee },
      { expiresIn: '5m' },
    );
  }, 120000);
  afterAll(async () => {
    if (app) await app.close();
    if (db) await db.close();
  });
  it('opens a branch-local annual requirement, including trainees joining afterwards', async () => {
    await service.openPeriod(actors.admin, {
      branchId: 'branch-test-a',
      activityYearId: yearId,
    });
    expect(await service.status(actors.trainee)).toMatchObject({
      annualRequired: true,
      wouldBlockAccess: true,
      accessBlocked: false,
    });
    expect(await service.status(actors.other)).toMatchObject({
      annualRequired: false,
    });
    const newcomer = randomUUID();
    await User.create({
      id: newcomer,
      name: 'Fictional newcomer',
      phoneNumber: '0500000000',
      branchId: 'branch-test-a',
      isActive: true,
    });
    await UserRole.create({
      userId: newcomer,
      roleId: 2,
      resourceId: 'branch-test-a',
    });
    expect(
      await service.status({ userId: newcomer, roles: [{ roleId: 2 }] }),
    ).toMatchObject({ annualRequired: true });
    expect(() =>
      service.openPeriod(actors.outside, {
        branchId: 'branch-test-a',
        activityYearId: yearId,
      }),
    ).toThrow();
  });
  it('persists drafts through real JWT HTTP, rejects extra identities and serializes competing revisions', async () => {
    await request(app.getHttpServer())
      .get('/parent-registration/me')
      .expect(401);
    await request(app.getHttpServer())
      .patch('/parent-registration/me/draft')
      .set('Authorization', `Bearer ${token}`)
      .send({ revision: 0, currentStep: 2, data: {}, traineeUuid: ids.other })
      .expect(400);
    const result = await request(app.getHttpServer())
      .patch('/parent-registration/me/draft')
      .set('Authorization', `Bearer ${token}`)
      .send({
        revision: 0,
        currentStep: 2,
        data: { trainee: { name: 'Fictional' } },
      })
      .expect(200);
    formId = result.body.form.id;
    const race = await Promise.allSettled(
      [1, 2].map(() =>
        service.saveDraft(actors.trainee, {
          revision: 1,
          currentStep: 3,
          data: { trainee: { name: 'Different' } },
        }),
      ),
    );
    expect(race.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(race.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect((await service.me(actors.trainee)).form?.revision).toBe(2);
  });
  it('submits once under concurrent retries; retains pending document state and encrypted IDs', async () => {
    const data = fictionalRegistration();
    const initial = await service.saveDraft(actors.trainee, {
      revision: 2,
      currentStep: 5,
      data,
    });
    expect(initial.data.signatures).toBeUndefined();
    const doc = (id: string, kind: string) => ({
      id,
      formId,
      kind,
      storageBucket: 'fictional-private-test',
      storagePath: `${formId}/${id}`,
      mimeType: kind === 'SIGNATURE' ? 'image/png' : 'application/pdf',
      fileSize: 123,
      checksum: 'a'.repeat(64),
      verifiedAt: new Date(),
    });
    // Test-only trusted adapter fixtures. They exercise metadata integrity and
    // approval transactions; they do not claim actual PDF/storage integration.
    await RegistrationFormDocument.bulkCreate([
      doc(data.medical!.physicianSummaryDocumentId!, 'PHYSICIAN_SUMMARY'),
      ...Object.values(data.signatures!).map((s) =>
        doc(s.documentId, 'SIGNATURE'),
      ),
    ]);
    await service.saveDraft(actors.trainee, {
      revision: 3,
      currentStep: 5,
      data,
    });
    const input = { formId, revision: 4, idempotencyKey: randomUUID() };
    await expect(service.submit(actors.other, input)).rejects.toThrow();
    const results = await Promise.all([
      service.submit(actors.trainee, input),
      service.submit(actors.trainee, input),
    ]);
    expect(results[0].versionId).toBe(results[1].versionId);
    expect(await RegistrationFormVersion.count({ where: { formId } })).toBe(1);
    const saved = await RegistrationFormVersion.findByPk(results[0].versionId);
    expect(saved!.formData.parent1!.nationalId).toMatch(/^v1:/);
    await expect(
      service.approve(actors.admin, formId, saved!.id),
    ).rejects.toThrow('verified in private storage');
    await expect(service.detail(actors.outside, formId)).rejects.toThrow();
  });
  it('enforces immutable evidence at the database level and app-level branch isolation', async () => {
    const version = await RegistrationFormVersion.findOne({
      where: { formId },
    });
    await expect(
      version!.update({ templateVersion: 'tamper' }),
    ).rejects.toThrow();
    await expect(version!.destroy()).rejects.toThrow();
    const history = await RegistrationFormHistory.findOne({
      where: { formId },
    });
    await expect(history!.update({ action: 'APPROVED' })).rejects.toThrow();
    const rows: any[] = await db.query(
      "SELECT relrowsecurity FROM pg_class WHERE relname IN ('activity_years','branch_registration_periods','registration_forms','registration_form_versions','registration_form_documents','registration_form_history')",
      { type: QueryTypes.SELECT },
    );
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
    await expect(
      service.requestChanges(actors.outside, formId, 'Not allowed'),
    ).rejects.toThrow();
    expect(
      await service.list(actors.outside, { page: 1, pageSize: 25 }),
    ).toMatchObject({ count: 0 });
    expect((await service.detail(actors.super, formId)).versions).toHaveLength(
      1,
    );
  });
  it('requests changes, creates a separate signed version, and retains previous evidence', async () => {
    const original = await RegistrationFormVersion.findOne({
      where: { formId },
    });
    const originalData = structuredClone(original!.formData);
    await service.requestChanges(
      actors.admin,
      formId,
      'Correct the fictional contact',
    );
    const current = await service.me(actors.trainee);
    expect(current.data.signatures).toBeUndefined();
    const data = current.data;
    data.contacts!.emergencyName = 'Corrected fictional contact';
    let saved = await service.saveDraft(actors.trainee, {
      revision: current.form!.revision,
      currentStep: 5,
      data,
    });
    const signatureId = randomUUID();
    await RegistrationFormDocument.create({
      id: signatureId,
      formId,
      kind: 'SIGNATURE',
      storageBucket: 'fictional-private-test',
      storagePath: `${formId}/${signatureId}`,
      mimeType: 'image/png',
      fileSize: 123,
      checksum: 'a'.repeat(64),
      verifiedAt: new Date(),
    });
    data.signatures = {
      parent1: {
        documentId: signatureId,
        contentHash: contentHash(data),
        signedAt: new Date().toISOString(),
      },
    };
    saved = await service.saveDraft(actors.trainee, {
      revision: saved.form!.revision,
      currentStep: 5,
      data,
    });
    await service.submit(actors.trainee, {
      formId,
      revision: saved.form!.revision,
      idempotencyKey: randomUUID(),
    });
    expect(await RegistrationFormVersion.count({ where: { formId } })).toBe(2);
    expect((await original!.reload()).formData).toEqual(originalData);
  });
  it('rolls approval back atomically and never replaces allergies or medications', async () => {
    const form = await RegistrationForm.findByPk(formId);
    const version = await RegistrationFormVersion.findOne({
      where: { formId },
      order: [['versionNumber', 'DESC']],
    });
    await RegistrationFormDocument.create({
      formId,
      versionId: version!.id,
      kind: 'REGISTRATION_PDF',
      storageBucket: 'fictional-private-test',
      storagePath: `${formId}/${randomUUID()}`,
      mimeType: 'application/pdf',
      fileSize: 123,
      checksum: 'b'.repeat(64),
      verifiedAt: new Date(),
    });
    await form!.update({ documentStatus: 'READY' });
    const before = (await User.findByPk(ids.trainee))!.name;
    const historySpy = jest
      .spyOn(RegistrationRepository.prototype, 'history')
      .mockRejectedValueOnce(new Error('Fictional audit failure'));
    try {
      await expect(
        service.approve(actors.admin, formId, version!.id),
      ).rejects.toThrow();
    } finally {
      historySpy.mockRestore();
    }
    expect((await User.findByPk(ids.trainee))!.name).toBe(before);
    expect((await form!.reload()).status).toBe('PENDING_REVIEW');
    await service.approve(actors.admin, formId, version!.id);
    expect((await User.findByPk(ids.trainee))!.allergies).toBe(
      'Existing allergy must stay',
    );
    expect(
      await Medication.count({ where: { traineeUuid: ids.trainee } }),
    ).toBe(1);
    expect(await service.status(actors.trainee)).toMatchObject({
      annualRequired: false,
      wouldBlockAccess: false,
    });
    await service.renew(actors.admin, ids.trainee, {
      branchId: 'branch-test-a',
      activityYearId: yearId,
      blocksAccess: false,
      reason: 'Fictional individual update',
    });
    expect(await service.status(actors.trainee)).toMatchObject({
      wouldBlockAccess: false,
    });
    expect((await service.me(actors.trainee)).previousApproved?.formId).toBe(
      formId,
    );
    expect(await RegistrationFormVersion.count({ where: { formId } })).toBe(2);
  });
});
