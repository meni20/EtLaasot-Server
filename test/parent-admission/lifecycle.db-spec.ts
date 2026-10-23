// PREPARED ONLY. Requires separate approval; never import AppModule/.env/cloud clients.
import 'reflect-metadata';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { Model, QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import {
  ADMISSION_MODELS,
  TraineeApplication,
  ApplicationEvidence,
  ApplicationVersion,
  ApplicantSession,
} from '../../src/modules/parent-admission/admission.entities';
import {
  REGISTRATION_MODELS,
  ActivityYear,
} from '../../src/modules/parent-registration/entities/registration.entities';
import { AdmissionRepository } from '../../src/modules/parent-admission/admission.repository';
import { AdmissionService } from '../../src/modules/parent-admission/admission.service';
import { AdmissionEvidenceGateway } from '../../src/modules/parent-admission/admission.evidence';
import { AuthorizationService } from '../../src/modules/auth/authorization.service';
import UserService from '../../src/modules/user/user.service';
import UserRepository from '../../src/modules/user/user.repository';
import UserRoleService from '../../src/modules/user-role/user-role.service';
import UserRoleRepository from '../../src/modules/user-role/user-role.repositroy';
import User from '../../src/modules/user/entities/user.entity';
import Branch from '../../src/modules/branch/entities/branch.entity';
import { getNationalIdDetails } from '../../src/modules/user/national-id.util';
import {
  contentHash,
  protectData,
} from '../../src/modules/parent-registration/registration.validation';
import {
  DECLARATIONS,
  DECLARATION_VERSION,
  TEMPLATE_VERSION,
} from '../../src/modules/parent-registration/declarations';
import { fictionalRegistration } from '../../src/modules/parent-registration/registration.test-fixtures';
import { credentialHash } from '../../src/modules/parent-admission/admission.security';
import { AdmissionRateLimiter } from '../../src/modules/parent-admission/admission.security';
import { RegistrationRequestAccess } from '../../src/modules/parent-registration/registration-request-access';
import { RegistrationService } from '../../src/modules/parent-registration/registration.service';
import { RegistrationRepository } from '../../src/modules/parent-registration/registration.repository';
import { DeferredRegistrationDocumentGenerator } from '../../src/modules/parent-registration/registration-document.generator';
const {
  assertTestTarget,
  createAttestedPg,
} = require('../../scripts/parent-registration-test-safety.cjs');

describe('Phase 4 real PostgreSQL transactions (approved isolated local DB only)', () => {
  let db: Sequelize,
    repo: AdmissionRepository,
    service: AdmissionService,
    admin: any;
  let nextId = 10000;
  function fictionalId() {
    const base = String(nextId++).padStart(8, '0');
    const sum = [...base].reduce((s, x, i) => {
      const n = Number(x) * ((i % 2) + 1);
      return s + (n > 9 ? n - 9 : n);
    }, 0);
    return base + String((10 - (sum % 10)) % 10);
  }
  beforeAll(async () => {
    if (process.env.PHASE4_TEST_APPROVED !== 'fresh-isolated-phase4-only')
      throw Error('Separate isolated Phase 4 approval required');
    const config = assertTestTarget();
    if (!/^etlaasot_parent_registration_test_phase4_/.test(config.database))
      throw Error('Wrong test database');
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
        application_name: 'parent-admission-isolated-tests',
      },
    });
    const existing: any[] = [];
    function visit(dir: string) {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, f.name);
        if (f.isDirectory()) visit(file);
        else if (f.name.endsWith('.entity.ts'))
          for (const item of Object.values(require(file)))
            if (typeof item === 'function' && item.prototype instanceof Model)
              existing.push(item);
      }
    }
    visit(path.resolve(__dirname, '../../src/modules'));
    db.addModels([
      ...new Set([...existing, ...REGISTRATION_MODELS, ...ADMISSION_MODELS]),
    ]);
    const [marker] = await db.query<{ nonce: string }>(
      'SELECT nonce FROM public.phase4_test_sandbox',
      { type: QueryTypes.SELECT },
    );
    if (marker?.nonce !== process.env.PHASE2_TEST_NONCE)
      throw Error('Phase 4 marker mismatch');
    await Branch.bulkCreate([
      { id: 'phase4-a', name: 'Fictional A', isActive: true },
      { id: 'phase4-b', name: 'Fictional B', isActive: true },
    ]);
    await db.query(
      "INSERT INTO roles(id,name) VALUES('2','Trainee'),('10000','Admin')",
    );
    const owner = await User.create({
      id: randomUUID(),
      name: 'Fictional administrator',
      phoneNumber: '0500000000',
      branchId: 'phase4-a',
    });
    admin = {
      userId: owner.id,
      roles: [{ roleId: 10000, branchId: 'phase4-a' }],
    };
    await ActivityYear.create({
      id: randomUUID(),
      name: 'Fictional current year',
      startsOn: '2020-01-01',
      endsOn: '2099-12-31',
      isActive: true,
    });
    repo = new AdmissionRepository(db);
    const users = new UserService(
      db,
      new UserRepository(),
      new UserRoleService(new UserRoleRepository()),
    );
    const fakeEvidence: AdmissionEvidenceGateway = {
      availability: () => 'READY',
      verify: async () => {},
      generate: async () => {},
    };
    service = new AdmissionService(
      repo,
      new AuthorizationService(),
      users,
      fakeEvidence,
    );
  });
  afterAll(async () => {
    if (db) await db.close();
  });
  async function pending() {
    const identifier = fictionalId(),
      created = await service.start(identifier, 'phase4-a'),
      data = fictionalRegistration(false);
    data.trainee!.nationalId = identifier;
    const hash = contentHash(data);
    data.signatures!.parent1!.contentHash = hash;
    const version = await ApplicationVersion.create({
      applicationId: created.application.id,
      versionNumber: 1,
      submittedRevision: 0,
      idempotencyKey: randomUUID(),
      formData: protectData(data),
      contentHash: hash,
      declarations: [...DECLARATIONS],
      declarationVersion: DECLARATION_VERSION,
      templateVersion: TEMPLATE_VERSION,
    });
    const docBase = {
      applicationId: created.application.id,
      storageBucket: 'fictional-test-private',
      fileSize: 100,
      checksum: 'a'.repeat(64),
      contentHash: hash,
      verifiedAt: new Date(),
    };
    await ApplicationEvidence.bulkCreate([
      {
        ...docBase,
        id: data.medical!.physicianSummaryDocumentId,
        kind: 'PHYSICIAN_SUMMARY',
        mimeType: 'application/pdf',
        storagePath: `fictional/${randomUUID()}.pdf`,
      },
      {
        ...docBase,
        id: data.signatures!.parent1!.documentId,
        kind: 'SIGNATURE',
        mimeType: 'image/png',
        storagePath: `fictional/${randomUUID()}.png`,
      },
      {
        ...docBase,
        versionId: version.id,
        kind: 'REGISTRATION_PDF',
        mimeType: 'application/pdf',
        storagePath: `fictional/${randomUUID()}.pdf`,
      },
    ]);
    await TraineeApplication.update(
      {
        status: 'PENDING_REVIEW',
        documentStatus: 'READY',
        draftData: protectData(data),
      },
      { where: { id: created.application.id } },
    );
    return { ...created, identifier, version };
  }
  it('serializes concurrent approvals: exactly one active account/temporary password response', async () => {
    const input = await pending();
    const results = await Promise.allSettled([
      service.approve(admin, input.application.id, input.version.id, true),
      service.approve(admin, input.application.id, input.version.id, true),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
    expect(results.filter((r) => r.status === 'rejected').length).toBe(1);
    expect(
      await User.count({
        where: {
          nationalIdHash: getNationalIdDetails(input.identifier).nationalIdHash,
        },
      }),
    ).toBe(1);
  });
  it('rolls back account, role and approval if the audit event fails', async () => {
    const input = await pending();
    const original = repo.event.bind(repo);
    const spy = jest
      .spyOn(repo, 'event')
      .mockImplementation((id, action, t, actor) =>
        action === 'APPROVED'
          ? Promise.reject(Error('Injected isolated audit failure'))
          : original(id, action, t, actor),
      );
    try {
      await expect(
        service.approve(admin, input.application.id, input.version.id, true),
      ).rejects.toThrow('Injected isolated audit failure');
    } finally {
      spy.mockRestore();
    }
    expect(
      await User.count({
        where: {
          nationalIdHash: getNationalIdDetails(input.identifier).nationalIdHash,
        },
      }),
    ).toBe(0);
    expect(
      (await TraineeApplication.findByPk(input.application.id))!.status,
    ).toBe('PENDING_REVIEW');
  });
  it('rotates and revokes real hashed credentials; IDs never act as credentials', async () => {
    const input = await service.start(fictionalId(), 'phase4-a');
    const recovered = await service.recover(input.recoveryCode);
    expect(
      await ApplicantSession.count({
        where: { tokenHash: credentialHash('session', input.token) },
      }),
    ).toBe(0);
    await expect(service.me(input.token)).rejects.toThrow();
    await service.revoke(recovered.token);
    await expect(service.me(recovered.token)).rejects.toThrow();
  });
  it('enforces unique identities under concurrent application creation', async () => {
    const id = fictionalId();
    const results = await Promise.allSettled([
      service.start(id, 'phase4-a'),
      service.start(id, 'phase4-a'),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled').length).toBe(1);
  });
  it('enforces a shared rate limit under parallel requests across service instances', async () => {
    const instances = [
      new AdmissionRateLimiter(db),
      new AdmissionRateLimiter(db),
    ];
    const results = await Promise.allSettled(
      Array.from({ length: 40 }, (_, i) =>
        instances[i % 2].consume('isolated-rate-check', 'fictional-peer'),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(30);
    expect(results.filter((r) => r.status === 'rejected').length).toBe(10);
  });
  it('verifies non-owner RLS access and immutable evidence ACLs without changing roles', async () => {
    await db.transaction(async (t) => {
      await db.query('SET LOCAL ROLE etlaasot_app', { transaction: t });
      const [r] = await db.query<{
        rls: boolean;
        update: boolean;
        owner: boolean;
      }>(
        "SELECT c.relrowsecurity rls,has_table_privilege(current_user,c.oid,'UPDATE') AS update,pg_get_userbyid(c.relowner)=current_user AS owner FROM pg_class c WHERE c.oid='public.trainee_application_versions'::regclass",
        { type: QueryTypes.SELECT, transaction: t },
      );
      expect(r.rls).toBe(true);
      expect(r.update).toBe(false);
      expect(r.owner).toBe(false);
      await db.query(
        'SELECT count(*) FROM public.trainee_application_versions',
        { transaction: t },
      );
    });
  });
  it('immediately restricts existing sessions on annual opening and respects current-year application approval and individual choices', async () => {
    const year = (await ActivityYear.findOne({ where: { isActive: true } }))!;
    const trainee = await User.create({
      id: randomUUID(),
      name: 'Fictional existing trainee',
      phoneNumber: '0500000000',
      branchId: 'phase4-a',
    });
    const actor = {
      userId: trainee.id,
      roles: [{ roleId: 2, branchId: 'phase4-a' }],
    };
    const ctx = (user: any) =>
      ({
        getHandler: () => function normalOperation() {},
        getClass: () => class NormalController {},
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
      }) as never;
    const access = new RegistrationRequestAccess(db),
      registration = new RegistrationService(
        new RegistrationRepository(db),
        new AuthorizationService(),
        new DeferredRegistrationDocumentGenerator(),
      );
    process.env.PARENT_REGISTRATION_BLOCKING_ENABLED = 'true';
    try {
      await access.assertRequest(ctx(actor));
      await registration.openPeriod(admin, {
        branchId: 'phase4-a',
        activityYearId: year.id,
      });
      await expect(access.assertRequest(ctx(actor))).rejects.toMatchObject({
        response: { code: 'PARENT_REGISTRATION_REQUIRED' },
      });
      for (const roleId of [1, 10000, 10001])
        await access.assertRequest(ctx({ ...actor, roles: [{ roleId }] }));
      const pendingA = await pending(),
        approvedA = await service.approve(
          admin,
          pendingA.application.id,
          pendingA.version.id,
          true,
        );
      const a = {
        userId: approvedA.userId,
        roles: [{ roleId: 2, branchId: 'phase4-a' }],
      };
      await access.assertRequest(ctx(a));
      expect((await registration.status(a)).annualRequired).toBe(false);
      await registration.renew(admin, approvedA.userId, {
        branchId: 'phase4-a',
        activityYearId: year.id,
        reason: 'Fictional nonblocking request',
        blocksAccess: false,
      });
      await access.assertRequest(ctx(a));
      const pendingB = await pending(),
        approvedB = await service.approve(
          admin,
          pendingB.application.id,
          pendingB.version.id,
          true,
        );
      await registration.renew(admin, approvedB.userId, {
        branchId: 'phase4-a',
        activityYearId: year.id,
        reason: 'Fictional blocking request',
        blocksAccess: true,
      });
      await expect(
        access.assertRequest(
          ctx({ userId: approvedB.userId, roles: [{ roleId: 2 }] }),
        ),
      ).rejects.toMatchObject({
        response: { code: 'PARENT_REGISTRATION_REQUIRED' },
      });
    } finally {
      process.env.PARENT_REGISTRATION_BLOCKING_ENABLED = 'false';
    }
  });
});
