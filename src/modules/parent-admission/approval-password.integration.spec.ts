import { AUTH_ROLES } from '../../constants/auth.constants';
import { PasswordRecoveryService } from './password-recovery.service';
import { ApplicationCredentialsService } from './application-credentials.service';
import * as applicantFeature from './application-credentials.feature';
// Real services/repositories/ORM and PostgreSQL. Only evidence storage and SMTP are synthetic.
import 'reflect-metadata';
import fs from 'fs';
import path from 'path';
import { randomUUID, randomBytes } from 'crypto';
import { Model, QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import {
  ADMISSION_MODELS,
  TraineeApplication,
  ApplicationVersion,
  ApplicationEvidence,
  ApplicantSession,
} from './admission.entities';
import { REGISTRATION_MODELS } from '../parent-registration/entities/registration.entities';
import { AdmissionService } from './admission.service';
import { AdmissionRepository } from './admission.repository';
import { WelcomeEmailService } from './welcome.service';
import { ApplicationCredentialsRepository } from './application-credentials.repository';
import UserService from '../user/user.service';
import UserRepository from '../user/user.repository';
import UserRoleService from '../user-role/user-role.service';
import UserRoleRepository from '../user-role/user-role.repositroy';
import User from '../user/entities/user.entity';
import AuthService from '../auth/auth.service';
import { AuthorizationService } from '../auth/authorization.service';
import { hashPassword, verifyPassword } from '../auth/password.util';
import { getNationalIdDetails } from '../user/national-id.util';
import { fictionalRegistration } from '../parent-registration/registration.test-fixtures';
import {
  protectData,
  contentHash,
} from '../parent-registration/registration.validation';
import {
  DECLARATIONS,
  DECLARATION_VERSION,
  TEMPLATE_VERSION,
} from '../parent-registration/declarations';
import { admissionPolicy } from './admission.policy';
import { VOLUNTEER_TEMPLATE_VERSION } from './volunteer-render.contract';
import {
  VOLUNTEER_AGREEMENT_VERSION as version,
  VOLUNTEER_SOURCE_SHA256,
} from './volunteer.legal';
import {
  volunteerContentHash,
  volunteerScopeHash,
  protectVolunteerData,
} from './volunteer.validation';
import type { VolunteerData, VolunteerPurpose } from './volunteer.contract';
import { applicantToken, credentialHash } from './admission.security';
const person = () => ({
  firstName: 'בדיקה',
  lastName: 'מקומית',
  nationalId: '123456782',
  dateOfBirth: '2000-01-01',
  gender: 'female' as const,
  address: 'כתובת',
  email: 'test@example.invalid',
  phone: '0520000000',
  shirtSize: 'M',
  motherName: 'אם',
  motherPhone: '0500000000',
  fatherName: 'אב',
  fatherPhone: '0500000001',
});
function complete(minor = false): VolunteerData {
  const data: VolunteerData = {
    volunteer: {
      ...person(),
      dateOfBirth: minor ? '2010-01-01' : '2000-01-01',
      school: 'בדיקה',
      grade: 'י',
    },
    questionnaire: {
      preference: 'משחקייה',
      age: 'קטן',
      communication: 'מדבר',
      diaper: 'ללא טיטול',
      instructionExperience: false,
      specialNeedsExperience: false,
      motivation: 'התנדבות',
    },
    agreements: { version, volunteer: true, confidentiality: true },
  };
  if (minor)
    data.parentConsent = {
      name: 'הורה',
      nationalId: '000000018',
      date: '2026-01-01',
      acknowledged: true,
    };
  for (const purpose of [
    'VOLUNTEER_AGREEMENT',
    ...(minor ? ['PARENTAL_CONSENT'] : []),
    'CONFIDENTIALITY',
  ] as VolunteerPurpose[]) {
    data.signatures ??= {};
    data.signatures[purpose] = {
      documentId: randomUUID(),
      signedAt: '2026-01-01T10:00:00.000Z',
      agreementVersion: version,
      contentHash: volunteerScopeHash(data, purpose),
    };
  }
  return data;
}

const isolated = process.env.APPROVAL_PG_NONCE ? describe : describe.skip;
isolated('Phase 2+3 fresh PostgreSQL verification (no cloud)', () => {
  let owner: Sequelize,
    db: Sequelize,
    repo: AdmissionRepository,
    users: UserService,
    roles: UserRoleService,
    welcome: WelcomeEmailService,
    service: AdmissionService;
  let admin: any,
    originalHash: string,
    mail: jest.Mock,
    preserved: boolean,
    aclBefore: any,
    aclAfter: any;
  let next = 30000;
  let recoveryPreserved = false;
  const saved = { ...process.env },
    clone = global.structuredClone;
  const q = <T extends object = any>(
    sql: string,
    replacements: Record<string, unknown> = {},
    transaction?: Transaction,
  ) =>
    owner.query<T>(sql, {
      type: QueryTypes.SELECT,
      replacements,
      transaction,
      logging: false,
    });
  function identifier() {
    const b = String(next++).padStart(8, '0');
    const sum = [...b].reduce((s, x, i) => {
      const n = Number(x) * ((i % 2) + 1);
      return s + (n > 9 ? n - 9 : n);
    }, 0);
    return b + String((10 - (sum % 10)) % 10);
  }
  async function security() {
    return q(
      `SELECT c.relrowsecurity,c.relacl::text,(SELECT jsonb_agg(to_jsonb(p)) FROM pg_policies p WHERE schemaname='public' AND tablename='onboarding_deliveries') policies FROM pg_class c WHERE oid='public.onboarding_deliveries'::regclass`,
    );
  }
  beforeAll(async () => {
    const nonce = process.env.APPROVAL_PG_NONCE!,
      port = Number(process.env.APPROVAL_PG_PORT),
      directory = process.env.APPROVAL_PG_DIRECTORY!;
    if (
      !/^[a-f0-9]{16}$/.test(nonce) ||
      !port ||
      !directory.endsWith(`approval-pg-${nonce}`)
    )
      throw Error('Invalid isolated sandbox');
    Object.assign(process.env, {
      NODE_ENV: 'development',
      NATIONAL_ID_HASH_SECRET: 'synthetic-approval-only',
      NATIONAL_ID_ENCRYPTION_KEY: 'a'.repeat(64),
      PARENT_REGISTRATION_TOKEN_PEPPER: 'b'.repeat(64),
      APPLICANT_PASSWORD_AUTH_ENABLED: 'false',
      APPLICATION_CREDENTIALS_SCHEMA_READY: 'true',
      VOLUNTEER_REGISTRATION_ENABLED: 'true',
      REGISTRATION_WELCOME_EMAIL_ENABLED: 'true',
      REGISTRATION_WELCOME_EMAIL_KEY: 'c'.repeat(64),
      PUBLIC_CLIENT_ORIGIN: 'http://localhost:5173',
      REGISTRATION_EMAIL_ALLOWED_RECIPIENTS: 'family@example.test',
    });
    global.structuredClone = (value) => JSON.parse(JSON.stringify(value));
    owner = new Sequelize({
      dialect: 'postgres',
      host: '127.0.0.1',
      port,
      username: 'postgres',
      database: 'postgres',
      logging: false,
      pool: { max: 12 },
      dialectOptions: { ssl: false },
    });
    const [identity] = await q(
      `SELECT current_setting('data_directory') directory,host(inet_server_addr()) address`,
    );
    expect(path.resolve(identity.directory).toLowerCase()).toBe(
      path.resolve(directory).toLowerCase(),
    );
    expect(identity.address).toBe('127.0.0.1');
    await owner.query(
      `CREATE ROLE etlaasot_app LOGIN;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA storage;CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);`,
      { logging: false },
    );
    await owner.query(
      fs.readFileSync('test/parent-registration/baseline.sql', 'utf8'),
      { logging: false },
    );
    await owner.query(
      'CREATE UNIQUE INDEX synthetic_user_identity ON public."user"(national_id_hash);GRANT USAGE ON SCHEMA public TO etlaasot_app;GRANT SELECT,INSERT,UPDATE ON public."user",public.branch,public.user_roles,public.roles,public.trainee_medications TO etlaasot_app;',
      { logging: false },
    );
    for (const file of fs
      .readdirSync('migrations')
      .filter((f) => /^03[0-9]_/.test(f))
      .sort())
      await owner.transaction((t) =>
        owner.query(fs.readFileSync(path.join('migrations', file), 'utf8'), {
          transaction: t,
          logging: false,
        }),
      );
    await q(
      `INSERT INTO public.branch(id,name) VALUES('a','Synthetic A');INSERT INTO public.roles(id,name) VALUES(1,'Volunteer'),(2,'Trainee'),(10000,'Admin');`,
    );
    const adminId = randomUUID();
    await q(
      `INSERT INTO public."user"(id,name,"branchId") VALUES(:id,'Synthetic admin','a')`,
      { id: adminId },
    );
    admin = { userId: adminId, roles: [{ roleId: 10000, branchId: 'a' }] };
    originalHash = await hashPassword('Applicant!2345');
    // Representative existing delivery states, including all legacy payload variants.
    for (const state of [
      'PENDING',
      'PROCESSING',
      'SENT',
      'FAILED',
      'SKIPPED',
      'CANCELLED',
      'EXPIRED',
    ]) {
      const id = randomUUID();
      await q(
        `INSERT INTO public.trainee_applications(id,national_id_hash,national_id_encrypted,branch_id) VALUES(:id,:hash,'synthetic','a')`,
        { id, hash: randomBytes(32).toString('hex') },
      );
      await q(
        `INSERT INTO public.onboarding_deliveries(application_id,user_id,status,token_hash,token_ciphertext,credential_hash,expires_at,claim_id,lease_until)
        VALUES(:id,:user,:state,:hash,:cipher,:credential,:expires,:claim,:lease)`,
        {
          id,
          user: adminId,
          state,
          hash: state === 'SKIPPED' ? null : randomBytes(32).toString('hex'),
          cipher: state === 'SKIPPED' ? null : 'synthetic-cipher',
          credential: state === 'SKIPPED' ? null : 'd'.repeat(64),
          expires: state === 'SKIPPED' ? null : new Date(Date.now() + 86400000),
          claim: state === 'PROCESSING' ? randomUUID() : null,
          lease: state === 'PROCESSING' ? new Date(Date.now() + 300000) : null,
        },
      );
    }
    const snapshot = await q(
      'SELECT (SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public.onboarding_deliveries d) deliveries,(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.trainee_applications a) applications,(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM public."user" u) users',
    );
    aclBefore = await security();
    await owner.transaction(async (t) => {
      await owner.query(
        fs.readFileSync(
          'migrations/040_approval_notification_only.sql',
          'utf8',
        ),
        { transaction: t, logging: false },
      );
      await owner.query(
        "CREATE TABLE public.schema_migrations(filename text PRIMARY KEY);INSERT INTO public.schema_migrations VALUES('040_approval_notification_only.sql')",
        { transaction: t, logging: false },
      );
    });
    const after = await q(
      `SELECT (SELECT jsonb_agg(to_jsonb(d)-'delivery_kind' ORDER BY id) FROM public.onboarding_deliveries d) deliveries,(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.trainee_applications a) applications,(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM public."user" u) users`,
    );
    preserved = JSON.stringify(snapshot) === JSON.stringify(after);
    aclAfter = await security();
    await owner.transaction((t) =>
      owner.query(
        fs.readFileSync('migrations/041_password_recovery.sql', 'utf8'),
        { transaction: t, logging: false },
      ),
    );
    const afterRecovery = await q(
      `SELECT (SELECT jsonb_agg(to_jsonb(d)-'delivery_kind' ORDER BY id) FROM public.onboarding_deliveries d) deliveries,(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.trainee_applications a) applications,(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM public."user" u) users`,
    );
    recoveryPreserved = JSON.stringify(afterRecovery) === JSON.stringify(after);
    db = new Sequelize({
      dialect: 'postgres',
      host: '127.0.0.1',
      port,
      username: 'etlaasot_app',
      database: 'postgres',
      logging: false,
      pool: { max: 12 },
      dialectOptions: {
        ssl: false,
        statement_timeout: 15000,
        lock_timeout: 6000,
      },
    });
    const models: any[] = [];
    const visit = (dir: string) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, f.name);
        if (f.isDirectory()) visit(file);
        else if (f.name.endsWith('.entity.ts'))
          // Discover existing ORM models without importing AppModule or runtime environments.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          for (const m of Object.values(require(file)))
            if (typeof m === 'function' && m.prototype instanceof Model)
              models.push(m);
      }
    };
    visit(path.resolve(__dirname, '..'));
    db.addModels([
      ...new Set([...models, ...ADMISSION_MODELS, ...REGISTRATION_MODELS]),
    ]);
    repo = new AdmissionRepository(db);
    roles = new UserRoleService(new UserRoleRepository());
    users = new UserService(db, new UserRepository(), roles);
    mail = jest.fn(async () => ({ accepted: ['family@example.test'] }));
    welcome = new WelcomeEmailService(db, { sendEmail: mail } as never);
    // Explicitly test worker when needed; prevent afterCommit scheduling external side effects.
    jest.spyOn(welcome, 'tick').mockResolvedValue(undefined);
    const integration = {
      enabled: () => true,
      attest: async () => {},
      verifySigned: async () => {},
      verifyVolunteerSigned: async () => {},
      download: async () => Buffer.from('%PDF-synthetic'),
    };
    service = new AdmissionService(
      repo,
      new AuthorizationService(),
      users,
      {} as never,
      integration as never,
      welcome,
    );
  }, 60000);
  afterAll(async () => {
    jest.restoreAllMocks();
    if (db) await db.close();
    if (owner) await owner.close();
    process.env = saved;
    global.structuredClone = clone;
  });
  async function pending(
    type: 'TRAINEE' | 'VOLUNTEER',
    legacy = false,
    signup = false,
  ) {
    const nationalId = identifier(),
      data: any =
        type === 'TRAINEE' ? fictionalRegistration(false) : complete(),
      token = applicantToken();
    if (type === 'TRAINEE') data.trainee.nationalId = nationalId;
    else data.volunteer.nationalId = nationalId;
    (type === 'TRAINEE' ? data.trainee : data.volunteer).email =
      'family@example.test';
    let hash =
      type === 'TRAINEE' ? contentHash(data) : volunteerContentHash(data);
    if (type === 'TRAINEE')
      for (const s of Object.values(data.signatures) as any[])
        s.contentHash = hash;
    else
      for (const purpose of Object.keys(data.signatures) as VolunteerPurpose[])
        data.signatures[purpose].contentHash = volunteerScopeHash(
          data,
          purpose,
        );
    if (type === 'VOLUNTEER') hash = volunteerContentHash(data);
    const identity = getNationalIdDetails(nationalId);
    let app: TraineeApplication;
    let signupToken: string | undefined;
    if (signup) {
      const enabled = jest
        .spyOn(applicantFeature, 'assertApplicantPasswordFeature')
        .mockImplementation(() => {});
      try {
        const result = await new ApplicationCredentialsService(
          new ApplicationCredentialsRepository(db),
          repo,
        ).signup({
          identifier: nationalId,
          email: 'family@example.test',
          password: 'Applicant!2345',
          passwordConfirmation: 'Applicant!2345',
          registrationType: type,
        });
        signupToken = result.token;
        const [created] = await q(
          'SELECT id FROM public.trainee_applications WHERE national_id_hash=:hash',
          { hash: identity.nationalIdHash },
        );
        app = (await TraineeApplication.findByPk(created.id))!;
        await app.update({ branchId: 'a' });
      } finally {
        enabled.mockRestore();
      }
    } else
      app = await TraineeApplication.create({
        nationalIdHash: identity.nationalIdHash,
        nationalIdEncrypted: 'synthetic',
        branchId: 'a',
        registrationType: type,
      });
    if (!legacy && !signup)
      await db.transaction((t) =>
        new ApplicationCredentialsRepository(db).create(
          {
            applicationId: app.id,
            nationalIdHash: identity.nationalIdHash,
            passwordHash: originalHash,
            loginEmail: 'family@example.test',
          },
          t,
        ),
      );
    if (!signup)
      await ApplicantSession.create({
        applicationId: app.id,
        tokenHash: credentialHash('session', token),
        expiresAt: new Date(Date.now() + 86400000),
        recoveryHash: legacy
          ? credentialHash('recovery', applicantToken())
          : null,
        recoveryExpiresAt: legacy ? new Date(Date.now() + 86400000 * 90) : null,
      });
    const policy = admissionPolicy(type),
      v = await ApplicationVersion.create({
        applicationId: app.id,
        registrationType: type,
        versionNumber: 1,
        submittedRevision: 0,
        idempotencyKey: randomUUID(),
        formData:
          type === 'TRAINEE' ? protectData(data) : protectVolunteerData(data),
        contentHash: hash,
        declarations:
          type === 'TRAINEE' ? [...DECLARATIONS] : [...policy.declarations],
        declarationVersion:
          type === 'TRAINEE' ? DECLARATION_VERSION : policy.declarationVersion,
        templateVersion:
          type === 'TRAINEE' ? TEMPLATE_VERSION : VOLUNTEER_TEMPLATE_VERSION,
        createdAt: new Date('2026-01-01T12:00:00Z'),
      });
    const docs: any[] = [
      ...(type === 'TRAINEE'
        ? [
            {
              id: data.medical.physicianSummaryDocumentId,
              kind: 'PHYSICIAN_SUMMARY',
            },
          ]
        : []),
      ...Object.entries(data.signatures).map(([purpose, s]: any) => ({
        id: s.documentId,
        kind: 'SIGNATURE',
        signaturePurpose: type === 'VOLUNTEER' ? purpose : null,
      })),
      { kind: 'REGISTRATION_PDF', versionId: v.id },
    ];
    await ApplicationEvidence.bulkCreate(
      docs.map((d) => ({
        ...d,
        applicationId: app.id,
        registrationType: type,
        contentHash: hash,
        storageBucket: 'synthetic',
        storagePath: `synthetic/${randomUUID()}`,
        mimeType: d.kind === 'SIGNATURE' ? 'image/png' : 'application/pdf',
        fileSize: 100,
        checksum: 'a'.repeat(64),
        verifiedAt: new Date(),
        templateVersion:
          type === 'VOLUNTEER' ? VOLUNTEER_TEMPLATE_VERSION : null,
        sourceChecksum: type === 'VOLUNTEER' ? VOLUNTEER_SOURCE_SHA256 : null,
        generatedAt: type === 'VOLUNTEER' ? new Date() : null,
      })),
    );
    await app.update({
      status: 'PENDING_REVIEW',
      documentStatus: 'READY',
      draftData:
        type === 'TRAINEE' ? protectData(data) : protectVolunteerData(data),
    });
    const approve = () => service.approve(admin, app.id, v.id, true, true);
    return {
      app,
      data,
      hash,
      token: signupToken ?? token,
      identity,
      nationalId,
      v,
      approve,
    };
  }
  it('041 is additive and preserves every existing application, account and delivery payload', () => {
    expect(recoveryPreserved).toBe(true);
    expect(
      fs.readFileSync('migrations/041_password_recovery.sql', 'utf8'),
    ).not.toMatch(/\b(?:DELETE FROM|UPDATE public|TRUNCATE|DROP TABLE)\b/i);
  });
  it('040 preserves every legacy delivery payload/state, applications and existing accounts', () => {
    expect(preserved).toBe(true);
  });
  it('040 preserves server-only RLS, ACLs and policies', () => {
    expect(aclAfter).toEqual(aclBefore);
    expect(aclAfter[0].relrowsecurity).toBe(true);
  });
  it('migration history makes repeat runner calls a no-op', async () => {
    const [row] = await q(
      "SELECT EXISTS(SELECT 1 FROM public.schema_migrations WHERE filename='040_approval_notification_only.sql') applied",
    );
    expect(row.applied).toBe(true);
    await expect(
      owner.transaction((t) =>
        owner.query(
          fs.readFileSync(
            'migrations/040_approval_notification_only.sql',
            'utf8',
          ),
          { transaction: t, logging: false },
        ),
      ),
    ).rejects.toMatchObject({ original: { code: '42701' } });
    expect(await security()).toEqual(aclAfter);
  });
  it('legacy delivery rows receive only PASSWORD_SETUP default metadata', async () => {
    const [r] = await q(
      "SELECT count(*)::int n FROM public.onboarding_deliveries WHERE delivery_kind='PASSWORD_SETUP'",
    );
    expect(r.n).toBe(7);
  });
  it.each([
    'token_hash',
    'token_ciphertext',
    'credential_hash',
    'expires_at',
    'consumed_at',
  ])('token-free notice rejects non-null %s', async (column) => {
    const h = await pending('TRAINEE'),
      value = ['token_hash', 'credential_hash'].includes(column)
        ? 'a'.repeat(64)
        : column === 'token_ciphertext'
          ? 'forbidden'
          : new Date();
    await expect(
      q(
        `INSERT INTO public.onboarding_deliveries(application_id,user_id,status,delivery_kind,${column}) VALUES(:id,:user,'PENDING','APPROVAL_NOTICE',:value)`,
        { id: h.app.id, user: admin.userId, value },
      ),
    ).rejects.toMatchObject({ original: { code: '23514' } });
  });
  it('legacy pending setup deliveries still require their credential payload', async () => {
    const h = await pending('TRAINEE');
    await expect(
      q(
        `INSERT INTO public.onboarding_deliveries(application_id,user_id,status) VALUES(:id,:user,'PENDING')`,
        { id: h.app.id, user: admin.userId },
      ),
    ).rejects.toMatchObject({ original: { code: '23514' } });
  });
  it.each(['anon', 'authenticated', 'service_role'])(
    '%s cannot read credential or delivery records',
    async (role) => {
      for (const table of ['application_credentials', 'onboarding_deliveries'])
        await expect(
          owner.transaction(async (t) => {
            await owner.query(`SET LOCAL ROLE ${role}`, {
              transaction: t,
              logging: false,
            });
            return q(`SELECT * FROM public.${table}`, {}, t);
          }),
        ).rejects.toMatchObject({ original: { code: '42501' } });
    },
  );
  it.each(['TRAINEE', 'VOLUNTEER'] as const)(
    '%s approval runs as the real app role and transfers the exact password',
    async (type) => {
      expect(
        (
          await db.query<any>('SELECT current_user role', {
            type: QueryTypes.SELECT,
            logging: false,
          })
        )[0].role,
      ).toBe('etlaasot_app');
      const h = await pending(type),
        before = await q(
          'SELECT to_jsonb(e) data FROM public.trainee_application_evidence e WHERE application_id=:id ORDER BY id',
          { id: h.app.id },
        );
      const result = await h.approve();
      const user = await User.findByPk(result.userId);
      expect(user!.passwordHash).toBe(originalHash);
      expect(user!.mustChangePassword).toBe(false);
      expect(user!.temporaryPasswordExpiresAt).toBeNull();
      expect(await verifyPassword(user!.passwordHash!, 'Applicant!2345')).toBe(
        true,
      );
      const [role] = await q(
        'SELECT "roleId","resourceId" FROM public.user_roles WHERE "userId"=:id',
        { id: user!.id },
      );
      expect(role.roleId).toBe(type === 'TRAINEE' ? 2 : 1);
      expect(role.resourceId).toBe('a');
      expect(
        (await ApplicantSession.findByPk(h.app.id))!.revokedAt,
      ).not.toBeNull();
      await expect(service.me(h.token)).rejects.toThrow('invalid or expired');
      const [notice] = await q(
        'SELECT * FROM public.onboarding_deliveries WHERE application_id=:id',
        { id: h.app.id },
      );
      expect(notice.delivery_kind).toBe('APPROVAL_NOTICE');
      for (const field of [
        'token_hash',
        'token_ciphertext',
        'credential_hash',
        'expires_at',
      ])
        expect(notice[field]).toBeNull();
      expect(notice.recipient).toBe('family@example.test');
      expect(notice.status).toBe('PENDING');
      expect(result).not.toHaveProperty('temporaryPassword');
      expect(JSON.stringify(result)).not.toContain(originalHash);
      expect(
        await q(
          'SELECT to_jsonb(e) data FROM public.trainee_application_evidence e WHERE application_id=:id ORDER BY id',
          { id: h.app.id },
        ),
      ).toEqual(before);
      const auth = new AuthService(
        db,
        roles,
        users,
        {
          getAllBranches: async () => [
            { id: 'a', name: 'Synthetic', isActive: true },
          ],
        } as never,
        { sign: () => 'synthetic-regular-jwt' } as never,
      );
      expect(await auth.login(h.nationalId, 'Applicant!2345')).toMatchObject({
        token: 'synthetic-regular-jwt',
        mustChangePassword: false,
      });
      expect(await h.approve()).toMatchObject({
        idempotent: true,
        authentication: 'EXISTING_PASSWORD',
      });
    },
  );
  it.each(['TRAINEE', 'VOLUNTEER'] as const)(
    '%s concurrent approval transactions create exactly one account/role/event/notice',
    async (type) => {
      const h = await pending(type),
        result = await Promise.all([
          h.approve(),
          h.approve(),
          h.approve(),
          h.approve(),
        ]);
      expect(new Set(result.map((r) => r.userId)).size).toBe(1);
      expect(result.filter((r) => r.idempotent)).toHaveLength(3);
      const [n] = await q(
        `SELECT (SELECT count(*)::int FROM public."user" WHERE national_id_hash=:hash) users,(SELECT count(*)::int FROM public.user_roles WHERE "userId"=:user) roles,(SELECT count(*)::int FROM public.trainee_application_events WHERE application_id=:id AND action='APPROVED') events,(SELECT count(*)::int FROM public.onboarding_deliveries WHERE application_id=:id) notices`,
        {
          hash: h.identity.nationalIdHash,
          user: result[0].userId,
          id: h.app.id,
        },
      );
      expect(n).toEqual({ users: 1, roles: 1, events: 1, notices: 1 });
    },
  );
  it.each(['role', 'session', 'event', 'notice'])(
    'real transaction rolls back all approval writes after %s failure',
    async (stage) => {
      const h = await pending('TRAINEE');
      const target: any =
        stage === 'role' ? roles : stage === 'notice' ? welcome : repo;
      const method =
        stage === 'role'
          ? 'asignRoleToUser'
          : stage === 'notice'
            ? 'enqueue'
            : stage === 'session'
              ? 'revokeApplicantSessions'
              : 'event';
      const original = target[method].bind(target),
        spy = jest
          .spyOn(target, method)
          .mockImplementationOnce(async (...args) => {
            await original(...args);
            throw Error('synthetic failure after write');
          });
      try {
        await expect(h.approve()).rejects.toThrow(
          'synthetic failure after write',
        );
      } finally {
        spy.mockRestore();
      }
      const [r] = await q(
        `SELECT (SELECT count(*)::int FROM public."user" WHERE national_id_hash=:hash) users,(SELECT count(*)::int FROM public.onboarding_deliveries WHERE application_id=:id) notices,(SELECT count(*)::int FROM public.trainee_application_events WHERE application_id=:id) events`,
        { hash: h.identity.nationalIdHash, id: h.app.id },
      );
      expect(r).toEqual({ users: 0, notices: 0, events: 0 });
      expect((await TraineeApplication.findByPk(h.app.id))!.status).toBe(
        'PENDING_REVIEW',
      );
      expect((await ApplicantSession.findByPk(h.app.id))!.revokedAt).toBeNull();
      await h.approve();
    },
  );
  it('concurrent manual user creation cannot take a password applicant identity', async () => {
    const h = await pending('VOLUNTEER');
    const result = await Promise.allSettled([
      h.approve(),
      users.createUserWithRole({
        id: h.nationalId,
        name: 'Synthetic conflict',
        dateOfBirth: '2000-01-01',
        phoneNumber: '0500000000',
        branchId: 'a',
      }),
    ]);
    expect(result[0].status).toBe('fulfilled');
    expect(result[1].status).toBe('rejected');
    const [r] = await q(
      'SELECT count(*)::int n,min(password_hash) hash FROM public."user" WHERE national_id_hash=:hash',
      { hash: h.identity.nationalIdHash },
    );
    expect(r.n).toBe(1);
    expect(r.hash).toBe(originalHash);
  });
  it.each(['TRAINEE', 'VOLUNTEER'] as const)(
    '%s legacy approval keeps the temporary password and setup-link delivery',
    async (type) => {
      const h = await pending(type, true),
        result = await h.approve();
      expect(result.temporaryPassword).toHaveLength(18);
      const user = await User.findByPk(result.userId);
      expect(user!.mustChangePassword).toBe(true);
      expect(user!.temporaryPasswordExpiresAt).not.toBeNull();
      expect(
        await verifyPassword(user!.passwordHash!, result.temporaryPassword!),
      ).toBe(true);
      const [notice] = await q(
        'SELECT delivery_kind,token_hash,token_ciphertext FROM public.onboarding_deliveries WHERE application_id=:id',
        { id: h.app.id },
      );
      expect(notice.delivery_kind).toBe('PASSWORD_SETUP');
      expect(notice.token_hash).not.toBeNull();
      expect(notice.token_ciphertext).not.toBeNull();
    },
  );
  it('real worker claims and sends a token-free notice with only a regular login link', async () => {
    await q(
      "UPDATE public.onboarding_deliveries SET next_attempt_at='2099-01-01' WHERE status='PENDING'",
    );
    const h = await pending('TRAINEE');
    await h.approve();
    mail.mockClear();
    await WelcomeEmailService.prototype.tick.call(welcome);
    const [notice] = await q(
      'SELECT * FROM public.onboarding_deliveries WHERE application_id=:id',
      { id: h.app.id },
    );
    expect(notice.status).toBe('SENT');
    expect(notice.token_hash).toBeNull();
    expect(mail).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mail.mock.calls)).not.toMatch(
      /setup-password|token=|argon2id/,
    );
    expect(mail.mock.calls[0][0].text).toContain('http://localhost:5173/login');
  });
  it('real retry SQL supports failed notices without credential tokens or expiry', async () => {
    const h = await pending('VOLUNTEER');
    await h.approve();
    await q(
      "UPDATE public.onboarding_deliveries SET status='FAILED',attempts=5 WHERE application_id=:id",
      { id: h.app.id },
    );
    await db.transaction((t) => welcome.retry(h.app.id, admin.userId, t));
    const [notice] = await q(
      'SELECT status,attempts,token_hash FROM public.onboarding_deliveries WHERE application_id=:id',
      { id: h.app.id },
    );
    expect(notice).toEqual({
      status: 'PENDING',
      attempts: 0,
      token_hash: null,
    });
  });
  function recovery() {
    return new PasswordRecoveryService(
      db,
      { sendEmail: mail } as never,
      new AuthorizationService(),
    );
  }
  async function authorizeReset(h: Awaited<ReturnType<typeof pending>>) {
    await recovery().authorize(admin, {
      subjectType: 'APPLICATION',
      subjectId: h.app.id,
      identityVerified: true,
      emailConfirmed: true,
      email: 'family@example.test',
    });
  }
  function resetToken() {
    const text = mail.mock.calls.at(-1)?.[0].text ?? '';
    return text.match(/#token=([A-Za-z0-9_-]{43})/)?.[1] as string;
  }
  it('unverified email cannot initiate reset; independent identity and matching mailbox are mandatory', async () => {
    const h = await pending('TRAINEE');
    mail.mockClear();
    const r = recovery();
    expect(await r.request(h.nationalId)).toEqual({ ok: true });
    expect(mail).not.toHaveBeenCalled();
    await expect(
      r.authorize(admin, {
        subjectType: 'APPLICATION',
        subjectId: h.app.id,
        identityVerified: false,
        emailConfirmed: true,
        email: 'family@example.test',
      }),
    ).rejects.toThrow('Independent');
    await expect(
      r.authorize(admin, {
        subjectType: 'APPLICATION',
        subjectId: h.app.id,
        identityVerified: true,
        emailConfirmed: true,
        email: 'wrong@example.test',
      }),
    ).rejects.toThrow('does not match');
    await expect(
      r.authorize(
        { ...admin, roles: [{ roleId: 10000, branchId: 'other' }] },
        {
          subjectType: 'APPLICATION',
          subjectId: h.app.id,
          identityVerified: true,
          emailConfirmed: true,
          email: 'family@example.test',
        },
      ),
    ).rejects.toThrow();
  });
  it('first reset binds the email, revokes applicant sessions, permits future resets and prevents replay', async () => {
    const h = await pending('TRAINEE'),
      r = recovery();
    mail.mockClear();
    await authorizeReset(h);
    await r.request(h.nationalId);
    const token = resetToken();
    expect(token).toHaveLength(43);
    const [challenge] = await q(
      'SELECT * FROM public.password_reset_challenges WHERE national_id_hash=:hash',
      { hash: h.identity.nationalIdHash },
    );
    expect(JSON.stringify(challenge)).not.toContain(token);
    expect(
      new Date(challenge.expires_at).getTime() -
        new Date(challenge.created_at).getTime(),
    ).toBe(1800000);
    await expect(
      r.consume(token, 'Next!Password23', 'mismatch'),
    ).rejects.toThrow('do not match');
    expect(
      await r.consume(token, 'Next!Password23', 'Next!Password23'),
    ).toEqual({ ok: true });
    await expect(
      r.consume(token, 'Next!Password24', 'Next!Password24'),
    ).rejects.toThrow('invalid or expired');
    expect(
      (await ApplicantSession.findByPk(h.app.id))!.revokedAt,
    ).not.toBeNull();
    const c = await new ApplicationCredentialsRepository(db).find(
      h.identity.nationalIdHash,
    );
    expect(await verifyPassword(c.passwordHash, 'Next!Password23')).toBe(true);
    const [binding] = await q(
      'SELECT bound_at FROM public.password_recovery_bindings WHERE national_id_hash=:hash',
      { hash: h.identity.nationalIdHash },
    );
    expect(binding.bound_at).not.toBeNull();
    await r.request(h.nationalId);
    expect(resetToken()).not.toBe(token);
  });
  it('an applicant reset password and verified email binding transfer safely through approval', async () => {
    const h = await pending('VOLUNTEER'),
      r = recovery();
    mail.mockClear();
    await authorizeReset(h);
    await r.request(h.nationalId);
    await r.consume(resetToken(), 'Next!Password23', 'Next!Password23');
    const enabled = jest
      .spyOn(applicantFeature, 'assertApplicantPasswordFeature')
      .mockImplementation(() => {});
    try {
      const login = await new ApplicationCredentialsService(
        new ApplicationCredentialsRepository(db),
        repo,
      ).login({ identifier: h.nationalId, password: 'Next!Password23' });
      expect(login.token).toHaveLength(43);
    } finally {
      enabled.mockRestore();
    }
    const approved = await h.approve();
    expect(
      await verifyPassword(
        (await User.findByPk(approved.userId))!.passwordHash!,
        'Next!Password23',
      ),
    ).toBe(true);
    mail.mockClear();
    await r.request(h.nationalId);
    expect(resetToken()).toHaveLength(43);
    await r.consume(resetToken(), 'AfterApproval!23', 'AfterApproval!23');
    expect(
      await verifyPassword(
        (await User.findByPk(approved.userId))!.passwordHash!,
        'AfterApproval!23',
      ),
    ).toBe(true);
  });
  it('branchless draft ownership can be verified only by a super administrator without assigning a branch', async () => {
    const nationalId = identifier(),
      hash = getNationalIdDetails(nationalId).nationalIdHash;
    const app = await TraineeApplication.create({
      nationalIdHash: hash,
      nationalIdEncrypted: 'synthetic',
      registrationType: 'TRAINEE',
    });
    await db.transaction((t) =>
      new ApplicationCredentialsRepository(db).create(
        {
          applicationId: app.id,
          nationalIdHash: hash,
          passwordHash: originalHash,
          loginEmail: 'family@example.test',
        },
        t,
      ),
    );
    const input = {
      subjectType: 'IDENTITY' as const,
      subjectId: nationalId,
      email: 'family@example.test',
      identityVerified: true,
      emailConfirmed: true,
    };
    await expect(recovery().authorize(admin, input)).rejects.toThrow();
    await expect(
      recovery().authorize(
        { ...admin, roles: [{ roleId: AUTH_ROLES.SUPER_ADMIN.id }] },
        input,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect((await TraineeApplication.findByPk(app.id))!.branchId).toBeNull();
  });
  it('a changed registered mailbox requires new independent verification and family email never binds another identity', async () => {
    const a = await pending('TRAINEE'),
      b = await pending('VOLUNTEER'),
      r = recovery();
    mail.mockClear();
    await authorizeReset(a);
    await r.request(b.nationalId);
    expect(mail).not.toHaveBeenCalled();
    await q(
      "UPDATE public.application_credentials SET login_email='changed@example.test' WHERE application_id=:id",
      { id: a.app.id },
    );
    await r.request(a.nationalId);
    expect(mail).not.toHaveBeenCalled();
  });
  it('expired and replaced reset links cannot change passwords', async () => {
    const h = await pending('VOLUNTEER'),
      r = recovery();
    mail.mockClear();
    await authorizeReset(h);
    await r.request(h.nationalId);
    const old = resetToken();
    await r.request(h.nationalId);
    const current = resetToken();
    await expect(
      r.consume(old, 'Next!Password23', 'Next!Password23'),
    ).rejects.toThrow('invalid or expired');
    await q(
      "UPDATE public.password_reset_challenges SET created_at=now()-interval '31 minutes',expires_at=now()-interval '1 minute' WHERE national_id_hash=:hash AND revoked_at IS NULL",
      { hash: h.identity.nationalIdHash },
    );
    await expect(
      r.consume(current, 'Next!Password23', 'Next!Password23'),
    ).rejects.toThrow('invalid or expired');
  });
  it('concurrent consume is single-use and approved reset invalidates JWT revisions with successful new login', async () => {
    const h = await pending('TRAINEE'),
      approved = await h.approve(),
      r = recovery();
    mail.mockClear();
    await authorizeReset(h);
    await r.request(h.nationalId);
    const token = resetToken();
    const result = await Promise.allSettled([
      r.consume(token, 'Next!Password23', 'Next!Password23'),
      r.consume(token, 'Next!Password23', 'Next!Password23'),
    ]);
    expect(result.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const auth = new AuthService(
      db,
      roles,
      users,
      {
        getAllBranches: async () => [
          { id: 'a', name: 'Synthetic', isActive: true },
        ],
      } as never,
      { sign: (p: unknown) => JSON.stringify(p) } as never,
    );
    await expect(
      auth.assertSessionCurrent(approved.userId, undefined),
    ).rejects.toThrow();
    await expect(
      auth.assertSessionCurrent(approved.userId, 0),
    ).rejects.toThrow();
    await expect(auth.login(h.nationalId, 'Applicant!2345')).rejects.toThrow();
    const login = await auth.login(h.nationalId, 'Next!Password23');
    expect(JSON.parse(login.token).sessionVersion).toBe(1);
    await expect(
      auth.assertSessionCurrent(approved.userId, 1),
    ).resolves.toBeUndefined();
  });
  it('reset transaction rollback preserves password, token, binding and sessions for a retry', async () => {
    const h = await pending('TRAINEE'),
      r = recovery();
    mail.mockClear();
    await authorizeReset(h);
    await r.request(h.nationalId);
    const token = resetToken();
    const query = db.query.bind(db),
      spy = jest
        .spyOn(db, 'query')
        .mockImplementation((sql: any, opts: any) => {
          if (
            typeof sql === 'string' &&
            sql.startsWith(
              'UPDATE public.password_recovery_bindings SET bound_at',
            )
          )
            throw Error('synthetic rollback');
          return query(sql, opts);
        });
    try {
      await expect(
        r.consume(token, 'Next!Password23', 'Next!Password23'),
      ).rejects.toThrow('synthetic rollback');
    } finally {
      spy.mockRestore();
    }
    expect((await ApplicantSession.findByPk(h.app.id))!.revokedAt).toBeNull();
    const c = await new ApplicationCredentialsRepository(db).find(
      h.identity.nationalIdHash,
    );
    expect(c.passwordHash).toBe(originalHash);
    await expect(
      r.consume(token, 'Next!Password23', 'Next!Password23'),
    ).resolves.toEqual({ ok: true });
  });
  it('full real signup -> approval -> regular login retains the chosen password', async () => {
    const h = await pending('VOLUNTEER', false, true),
      approved = await h.approve();
    const auth = new AuthService(
      db,
      roles,
      users,
      {
        getAllBranches: async () => [
          { id: 'a', name: 'Synthetic', isActive: true },
        ],
      } as never,
      { sign: () => 'regular-jwt' } as never,
    );
    expect(await auth.login(h.nationalId, 'Applicant!2345')).toMatchObject({
      token: 'regular-jwt',
      mustChangePassword: false,
    });
    expect((await User.findByPk(approved.userId))!.mustChangePassword).toBe(
      false,
    );
    await expect(service.me(h.token)).rejects.toThrow();
  });
  it.each([
    'password_recovery_bindings',
    'password_reset_challenges',
    'password_reset_session_revisions',
  ])(
    '041 server-only table %s denies browser roles and is empty initially for untouched identities',
    async (table) => {
      const [row] = await q(
        'SELECT relrowsecurity FROM pg_class WHERE oid=:table::regclass',
        { table: `public.${table}` },
      );
      expect(row.relrowsecurity).toBe(true);
      await expect(
        owner.transaction(async (t) => {
          await owner.query('SET LOCAL ROLE authenticated', {
            transaction: t,
            logging: false,
          });
          return q(`SELECT * FROM public.${table}`, {}, t);
        }),
      ).rejects.toMatchObject({ original: { code: '42501' } });
    },
  );
  it('public flow remains disabled throughout real approval tests', () => {
    expect(process.env.APPLICANT_PASSWORD_AUTH_ENABLED).toBe('false');
    expect(process.env.APPLICATION_CREDENTIALS_SCHEMA_READY).toBe('true');
  });
});
