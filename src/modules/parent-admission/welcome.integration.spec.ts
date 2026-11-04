import { readFileSync } from 'fs';
import { randomBytes, randomUUID } from 'crypto';
import { Sequelize } from 'sequelize-typescript';
import { QueryTypes, Transaction } from 'sequelize';
import { WelcomeEmailService } from './welcome.service';
import { digest, openToken, welcomeConfig } from './welcome.security';
import { hashPassword, verifyPassword } from '../auth/password.util';
import UserService from '../user/user.service';
import { Logger } from '@nestjs/common';

// Only the fresh-cluster launcher may enable these tests. No application .env.
const nonce = process.env.ONBOARDING_ISOLATED_NONCE;
const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const integration = nonce && url ? describe : describe.skip;
integration(
  'Welcome onboarding: isolated PostgreSQL concurrency and credential boundaries',
  () => {
    let db: Sequelize, service: WelcomeEmailService, send: jest.Mock;
    let app: string, user: string, credential: string;
    const savedEnv = { ...process.env };
    const q = <T extends object = Record<string, any>>(
      sql: string,
      replacements: Record<string, unknown> = {},
      transaction?: Transaction,
    ) =>
      db.query<T>(sql, {
        replacements,
        transaction,
        type: QueryTypes.SELECT,
        logging: false,
      });
    beforeAll(async () => {
      if (
        !/^[a-f0-9]{16}$/.test(nonce!) ||
        url !== `postgres://postgres@127.0.0.1:55447/onboarding_test_${nonce}`
      )
        throw Error('Fresh loopback onboarding test database required');
      db = new Sequelize(url!, {
        dialect: 'postgres',
        logging: false,
        pool: { max: 6 },
      });
      const [identity] = await q<{ db: string }>(
        'SELECT current_database() AS db',
      );
      if (identity.db !== `onboarding_test_${nonce}`)
        throw Error('Test database identity mismatch');
      await db.query(
        `CREATE ROLE etlaasot_app; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE public."user"(id uuid PRIMARY KEY,password_hash text,national_id_hash text,phone_number text,
        email text,"branchId" text,is_active boolean DEFAULT true,"deletedAt" timestamptz,
        must_change_password boolean DEFAULT true,password_changed_at timestamptz,
        temporary_password_expires_at timestamptz,failed_login_attempts integer DEFAULT 0,locked_until timestamptz,"updatedAt" timestamptz);
      CREATE TABLE public.user_roles("userId" uuid REFERENCES public."user", "roleId" integer,"deletedAt" timestamptz);
      CREATE TABLE public.trainee_applications(id uuid PRIMARY KEY,status text,"branchId" text,provisioned_user_id uuid);
      GRANT USAGE ON SCHEMA public TO etlaasot_app;
      GRANT SELECT,INSERT,UPDATE ON public."user",public.user_roles,public.trainee_applications TO etlaasot_app;`,
        { logging: false },
      );
      await db.query(
        readFileSync('migrations/037_registration_welcome_email.sql', 'utf8'),
        { logging: false },
      );
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });
    afterAll(async () => {
      if (db) await db.close();
      process.env = savedEnv;
      jest.restoreAllMocks();
    });
    beforeEach(async () => {
      await db.query(
        'TRUNCATE public.onboarding_deliveries,public.trainee_applications,public.user_roles,public."user"',
        { logging: false },
      );
      process.env.NODE_ENV = 'development';
      delete process.env.RAILWAY_ENVIRONMENT_ID;
      delete process.env.RAILWAY_PROJECT_ID;
      delete process.env.RAILWAY_SERVICE_ID;
      process.env.REGISTRATION_WELCOME_EMAIL_ENABLED = 'true';
      process.env.REGISTRATION_WELCOME_EMAIL_KEY =
        randomBytes(32).toString('hex');
      process.env.PUBLIC_CLIENT_ORIGIN = 'http://localhost:5173';
      process.env.REGISTRATION_EMAIL_ALLOWED_RECIPIENTS =
        'welcome@example.test';
      process.env.NATIONAL_ID_HASH_SECRET = 'fictional-onboarding-only';
      process.env.NATIONAL_ID_ENCRYPTION_KEY = randomBytes(32).toString('hex');
      app = randomUUID();
      user = randomUUID();
      credential = await hashPassword('Original!Temporary56');
      await q(
        'INSERT INTO public."user"(id,password_hash,phone_number,email,"branchId") VALUES(:id,:hash,:phone,:email,:branch)',
        {
          id: user,
          hash: credential,
          phone: '0500000000',
          email: 'welcome@example.test',
          branch: 'fictional-branch',
        },
      );
      await q(
        'INSERT INTO public.user_roles("userId","roleId") VALUES(:id,1)',
        { id: user },
      );
      await q(
        "INSERT INTO public.trainee_applications(id,status,\"branchId\") VALUES(:id,'PENDING_REVIEW','fictional-branch')",
        { id: app },
      );
      send = jest.fn(async (_input: any) => ({
        accepted: ['welcome@example.test'],
        rejected: [],
        messageId: 'test',
      }));
      service = new WelcomeEmailService(db, { sendEmail: send } as never);
      // Explicitly drive the worker; commit callbacks cannot send to real SMTP.
      jest.spyOn(service, 'tick').mockResolvedValue(undefined);
    });
    async function queue(
      authorized = true,
      email = 'welcome@example.test',
      t?: Transaction,
    ) {
      const work = (tx: Transaction) =>
        service.enqueue(
          {
            applicationId: app,
            userId: user,
            passwordHash: credential,
            email,
            authorized,
          },
          tx,
        );
      return t ? work(t) : db.transaction(work);
    }
    async function row() {
      return (
        await q<any>(
          'SELECT * FROM public.onboarding_deliveries WHERE application_id=:id',
          { id: app },
        )
      )[0];
    }
    async function token() {
      const r = await row();
      return openToken(r.token_ciphertext, r.id, welcomeConfig().key);
    }
    async function tick() {
      await WelcomeEmailService.prototype.tick.call(service);
    }

    it('stores a hash and authenticated ciphertext, sends only after commit, and purges the encrypted payload', async () => {
      await db.transaction(async (t) => {
        await queue(true, 'welcome@example.test', t);
        expect(send).not.toHaveBeenCalled();
        expect(await row()).toBeUndefined();
      });
      const raw = await token(),
        pending = await row();
      expect(pending.token_hash).toBe(digest(raw));
      expect(JSON.stringify(pending)).not.toContain(raw);
      await tick();
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][0].text).not.toContain('Original!Temporary56');
      expect((await row()).token_ciphertext).toBeNull();
      expect((await service.status(app)).status).toBe('SENT');
    });
    it('consumes a token only once under simultaneous submissions and uses Argon2/normal-login state', async () => {
      await queue();
      const raw = await token();
      const results = await Promise.allSettled([
        service.consume(raw, 'Chosen!Secret56', 'Chosen!Secret56'),
        service.consume(raw, 'Other!Secret56', 'Other!Secret56'),
      ]);
      expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      const [u] = await q<any>('SELECT * FROM public."user" WHERE id=:id', {
        id: user,
      });
      expect(u.must_change_password).toBe(false);
      expect(u.temporary_password_expires_at).toBeNull();
      expect(
        await verifyPassword(
          u.password_hash,
          results[0].status === 'fulfilled'
            ? 'Chosen!Secret56'
            : 'Other!Secret56',
        ),
      ).toBe(true);
      await expect(
        service.consume(raw, 'Chosen!Secret56', 'Chosen!Secret56'),
      ).rejects.toThrow('invalid or expired');
    });
    it('rejects expired tokens without changing credentials', async () => {
      await queue();
      const raw = await token();
      await q(
        "UPDATE public.onboarding_deliveries SET expires_at=now()-interval '1 second' WHERE application_id=:id",
        { id: app },
      );
      await expect(
        service.consume(raw, 'Chosen!Secret56', 'Chosen!Secret56'),
      ).rejects.toThrow('invalid or expired');
      expect(
        (
          await q<any>('SELECT password_hash FROM public."user" WHERE id=:id', {
            id: user,
          })
        )[0].password_hash,
      ).toBe(credential);
    });
    it('keeps the existing manager reset: new temporary password works, requires change, and old setup token fails', async () => {
      await queue();
      const raw = await token();
      const users = new UserService(
        db,
        {
          updatePasswordAuthState: async (id: string, data: any) => {
            await db.transaction(async (t) => {
              await db.query('SET LOCAL ROLE etlaasot_app', { transaction: t });
              await q(
                `UPDATE public."user" SET password_hash=:hash,must_change_password=:change,
          temporary_password_expires_at=:expires,password_changed_at=:changed WHERE id=:id`,
                {
                  id,
                  hash: data.passwordHash,
                  change: data.mustChangePassword,
                  expires: data.temporaryPasswordExpiresAt,
                  changed: data.passwordChangedAt,
                },
                t,
              );
            });
            return {};
          },
        } as never,
        {} as never,
      );
      const result = await users.resetPassword(user);
      const [u] = await q<any>('SELECT * FROM public."user" WHERE id=:id', {
        id: user,
      });
      expect(
        await verifyPassword(u.password_hash, result.temporaryPassword),
      ).toBe(true);
      expect(u.must_change_password).toBe(true);
      expect(
        new Date(u.temporary_password_expires_at).getTime(),
      ).toBeGreaterThan(Date.now());
      expect((await row()).revoked_at).toBeTruthy();
      await expect(
        service.consume(raw, 'Chosen!Secret56', 'Chosen!Secret56'),
      ).rejects.toThrow();
    });
    it.each([
    "password_hash='changed-hash'",
    'must_change_password=false',
    'temporary_password_expires_at=now()',
    'password_changed_at=now()',
    "national_id_hash='changed-identity-hash'",
      'is_active=false',
      '"deletedAt"=now()',
      "email='changed@example.test'",
      '"branchId"=\'other-branch\'',
    ])(
      'revokes outstanding links after credential/account change: %s',
      async (change) => {
        await queue();
        const raw = await token();
        // The SQL fragment is a fixed test case, never a request parameter.
        await q(`UPDATE public."user" SET ${change} WHERE id=:id`, {
          id: user,
        });
        expect((await row()).token_ciphertext).toBeNull();
        await expect(
          service.consume(raw, 'Chosen!Secret56', 'Chosen!Secret56'),
        ).rejects.toThrow();
      },
    );
    it('revokes links after role changes', async () => {
      await queue();
      const raw = await token();
      await q(
        'UPDATE public.user_roles SET "deletedAt"=now() WHERE "userId"=:id',
        { id: user },
      );
      await expect(
        service.consume(raw, 'Chosen!Secret56', 'Chosen!Secret56'),
      ).rejects.toThrow();
    });
    it('concurrent approval transactions create exactly one account association/outbox; rollback removes queued mail', async () => {
      const approve = () =>
        db.transaction(async (t) => {
          const [a] = await q<any>(
            'SELECT * FROM public.trainee_applications WHERE id=:id FOR UPDATE',
            { id: app },
            t,
          );
          if (a.status === 'APPROVED') return;
          await q(
            "UPDATE public.trainee_applications SET status='APPROVED',provisioned_user_id=:user WHERE id=:id",
            { id: app, user },
            t,
          );
          await queue(true, 'welcome@example.test', t);
        });
      await Promise.all([approve(), approve()]);
      expect(
        (
          await q<any>(
            'SELECT count(*)::int AS n FROM public.onboarding_deliveries WHERE application_id=:id',
            { id: app },
          )
        )[0].n,
      ).toBe(1);
      await expect(
        db.transaction(async (t) => {
          const other = randomUUID();
          await q(
            "INSERT INTO public.trainee_applications(id,status) VALUES(:id,'APPROVED')",
            { id: other },
            t,
          );
          await service.enqueue(
            {
              applicationId: other,
              userId: user,
              passwordHash: credential,
              email: 'welcome@example.test',
              authorized: true,
            },
            t,
          );
          throw Error('synthetic approval failure');
        }),
      ).rejects.toThrow('synthetic approval failure');
      expect(send).not.toHaveBeenCalled();
    });
    it('SMTP failure preserves approval/credentials; two replicas claim once and retries use the same link', async () => {
      await queue();
      const raw = await token();
      const replica = new WelcomeEmailService(db, { sendEmail: send } as never);
      send.mockRejectedValueOnce(Error('fictional SMTP timeout'));
      await Promise.all([tick(), replica.tick()]);
      expect(send).toHaveBeenCalledTimes(1);
      expect((await row()).status).toBe('PENDING');
      expect((await row()).credential_hash).toBe(digest(credential));
      await q(
        'UPDATE public.onboarding_deliveries SET next_attempt_at=now() WHERE application_id=:id',
        { id: app },
      );
      await tick();
      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[0][0].text).toContain(raw);
      expect(send.mock.calls[1][0].text).toContain(raw);
      expect(send.mock.calls[0][0].messageId).toBe(
        send.mock.calls[1][0].messageId,
      );
    });
    it('enforces five attempts and permits explicit retry without creating a different token', async () => {
      await queue();
      const raw = await token();
      send.mockRejectedValue(Error('fictional SMTP failure'));
      for (let i = 0; i < 7; i++) {
        await q(
          'UPDATE public.onboarding_deliveries SET next_attempt_at=now() WHERE application_id=:id',
          { id: app },
        );
        await tick();
      }
      expect(send).toHaveBeenCalledTimes(5);
      expect((await row()).status).toBe('FAILED');
      await db.transaction((t) => service.retry(app, user, t));
      expect(await token()).toBe(raw);
      expect((await row()).attempts).toBe(0);
    });
    it.each([
      [false, 'welcome@example.test', 'RECIPIENT_NOT_CONFIRMED'],
      [true, '', 'NO_EMAIL'],
      [true, 'outside@example.test', 'DEV_RECIPIENT_BLOCKED'],
    ] as const)(
      'preserves manual handoff when email is unsuitable (%s, %s)',
      async (authorized, email, reason) => {
        await queue(authorized, email);
        await tick();
        expect((await row()).reason).toBe(reason);
        expect((await row()).token_hash).toBeNull();
        expect(send).not.toHaveBeenCalled();
      },
    );
    it('denies browser database roles while preserving dedicated application access', async () => {
      await queue();
      const [acl] =
        await q<any>(`SELECT has_table_privilege('anon','public.onboarding_deliveries','SELECT') AS anon,
      has_table_privilege('authenticated','public.onboarding_deliveries','SELECT') AS browser,
      has_table_privilege('service_role','public.onboarding_deliveries','SELECT') AS service`);
      expect(acl).toEqual({ anon: false, browser: false, service: false });
      await db.transaction(async (t) => {
        await db.query('SET LOCAL ROLE etlaasot_app', { transaction: t });
        expect(
          await q(
            'SELECT id FROM public.onboarding_deliveries WHERE application_id=:id',
            { id: app },
            t,
          ),
        ).toHaveLength(1);
      });
    });
  },
);
