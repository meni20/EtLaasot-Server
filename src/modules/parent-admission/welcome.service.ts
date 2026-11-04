import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { QueryTypes, Transaction } from 'sequelize';
import { randomBytes, randomUUID } from 'crypto';
import { isEmail } from 'class-validator';
import { EmailService } from '../email/email.service';
import { getBooleanEnv } from '../../config/env.util';
import { hashPassword, validateNewPassword } from '../auth/password.util';
import {
  digest,
  openToken,
  sealToken,
  TOKEN_PATTERN,
  welcomeConfig,
} from './welcome.security';

type Delivery = {
  id: string;
  application_id: string;
  user_id: string;
  recipient: string | null;
  status: string;
  reason: string | null;
  token_hash: string | null;
  token_ciphertext: string | null;
  credential_hash: string | null;
  expires_at: Date;
  consumed_at: Date | null;
  revoked_at: Date | null;
  attempts: number;
  claim_id: string | null;
  sent_at: Date | null;
};
type CredentialUser = {
  id: string;
  password_hash: string;
  national_id_hash: string;
  phone_number: string;
  is_active: boolean;
  must_change_password: boolean;
  deletedAt: Date | null;
};
export type WelcomeStatus = {
  status: string;
  recipient?: string;
  reason?: string | null;
  passwordSet?: boolean;
  retryable?: boolean;
};

@Injectable()
export class WelcomeEmailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WelcomeEmailService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(
    @InjectConnection() private readonly db: Sequelize,
    private readonly email: EmailService,
  ) {}
  enabled() {
    return getBooleanEnv('REGISTRATION_WELCOME_EMAIL_ENABLED', false);
  }
  private query<T extends object>(
    sql: string,
    replacements: Record<string, unknown> = {},
    transaction?: Transaction,
  ): Promise<T[]> {
    return this.db.query<T>(sql, {
      replacements,
      transaction,
      type: QueryTypes.SELECT,
      logging: false,
    });
  }
  async onModuleInit() {
    if (!this.enabled()) return;
    welcomeConfig();
    const [schema] = await this.query<{ ready: boolean }>(
      "SELECT to_regclass('public.onboarding_deliveries') IS NOT NULL AS ready",
    );
    if (!schema?.ready) throw Error('WELCOME_MIGRATION_037_REQUIRED');
    this.timer = setInterval(() => {
      void this.tick();
    }, 15000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async enqueue(
    input: {
      applicationId: string;
      userId: string;
      passwordHash: string | null;
      email?: string;
      authorized: boolean;
    },
    t: Transaction,
  ): Promise<WelcomeStatus> {
    if (!this.enabled()) return { status: 'DISABLED' };
    if (!input.passwordHash)
      throw new ConflictException('Provisioned credential is required');
    const config = welcomeConfig(),
      recipient = input.email?.trim() || null;
    const reason =
      !recipient || !isEmail(recipient)
        ? 'NO_EMAIL'
        : !input.authorized
          ? 'RECIPIENT_NOT_CONFIRMED'
          : !config.production &&
              !config.recipients.includes(recipient.toLowerCase())
            ? 'DEV_RECIPIENT_BLOCKED'
            : null;
    const id = randomUUID(),
      token = reason ? null : randomBytes(32).toString('base64url');
    await this.query(
      `INSERT INTO public.onboarding_deliveries
      (id,application_id,user_id,recipient,status,reason,token_hash,token_ciphertext,credential_hash,expires_at)
      VALUES(:id,:application,:user,:recipient,:status,:reason,:hash,:cipher,:credential,:expires)
      ON CONFLICT(application_id) DO NOTHING`,
      {
        id,
        application: input.applicationId,
        user: input.userId,
        recipient,
        status: reason ? 'SKIPPED' : 'PENDING',
        reason,
        hash: token ? digest(token) : null,
        cipher: token ? sealToken(token, id, config.key) : null,
        credential: token ? digest(input.passwordHash) : null,
        expires: token ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null,
      },
      t,
    );
    // Never await SMTP in the transaction or its commit callback.
    t.afterCommit(() => {
      setImmediate(() => {
        void this.tick();
      });
    });
    return this.status(input.applicationId, t);
  }
  async status(applicationId: string, t?: Transaction): Promise<WelcomeStatus> {
    if (!this.enabled()) return { status: 'DISABLED' };
    const [row] = await this.query<Delivery>(
      'SELECT * FROM public.onboarding_deliveries WHERE application_id=:id',
      { id: applicationId },
      t,
    );
    if (!row) return { status: 'NOT_QUEUED' };
    const expired =
      row.expires_at && new Date(row.expires_at).getTime() <= Date.now();
    return {
      status: row.status,
      reason: row.reason,
      passwordSet: !!row.consumed_at,
      recipient: row.recipient
        ? row.recipient.replace(/^(.).*(@.*)$/, '$1***$2')
        : undefined,
      retryable:
        row.status === 'FAILED' &&
        !expired &&
        !row.revoked_at &&
        !row.consumed_at &&
        !!row.token_ciphertext,
    };
  }
  async retry(applicationId: string, actor: string, t: Transaction) {
    if (!this.enabled()) throw new NotFoundException();
    const rows = await this.query<Delivery>(
      `UPDATE public.onboarding_deliveries SET
      status='PENDING',reason=NULL,attempts=0,next_attempt_at=now(),retry_requested_by=:actor,retry_requested_at=now()
      WHERE application_id=:id AND status='FAILED' AND expires_at>now()
      AND consumed_at IS NULL AND revoked_at IS NULL AND token_ciphertext IS NOT NULL RETURNING *`,
      { id: applicationId, actor },
      t,
    );
    if (!rows.length)
      throw new ConflictException(
        'Welcome email cannot be retried; use the existing manual password reset if needed',
      );
    t.afterCommit(() => {
      setImmediate(() => {
        void this.tick();
      });
    });
    return this.status(applicationId, t);
  }
  async tick() {
    if (!this.enabled() || this.running) return;
    this.running = true;
    try {
      const config = welcomeConfig();
      await this
        .query(`UPDATE public.onboarding_deliveries SET status='EXPIRED',token_ciphertext=NULL,claim_id=NULL,lease_until=NULL
        WHERE status IN ('PENDING','PROCESSING','FAILED') AND expires_at<=now()`);
      await this
        .query(`UPDATE public.onboarding_deliveries SET status='FAILED',reason='RETRY_LIMIT',claim_id=NULL,lease_until=NULL
        WHERE status='PROCESSING' AND lease_until<=now() AND attempts>=5`);
      const claim = randomUUID();
      const [row] = await this.query<Delivery>(
        `WITH candidate AS (
        SELECT id FROM public.onboarding_deliveries
        WHERE ((status='PENDING' AND next_attempt_at<=now()) OR (status='PROCESSING' AND lease_until<=now()))
          AND attempts<5 AND expires_at>now() AND consumed_at IS NULL AND revoked_at IS NULL AND token_ciphertext IS NOT NULL
        ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 1
      ) UPDATE public.onboarding_deliveries d SET status='PROCESSING',attempts=attempts+1,claim_id=:claim,
        lease_until=now()+interval '5 minutes' FROM candidate c WHERE d.id=c.id RETURNING d.*`,
        { claim },
      );
      if (!row) return;
      // Recheck the DEV allowlist on every attempt, including after config changes.
      if (
        !row.recipient ||
        (!config.production &&
          !config.recipients.includes(row.recipient.toLowerCase()))
      ) {
        await this.finish(row, 'CANCELLED', 'DEV_RECIPIENT_BLOCKED', true);
        return;
      }
      try {
        const token = openToken(row.token_ciphertext!, row.id, config.key);
        if (!TOKEN_PATTERN.test(token) || digest(token) !== row.token_hash)
          throw Error('INVALID_PAYLOAD');
        const login = `${config.origin}/login`,
          setup = `${config.origin}/setup-password#token=${token}`;
        const result = await this.email.sendEmail({
          to: row.recipient,
          messageId: `<welcome-${row.id}@${new URL(config.origin).hostname}>`,
          subject: 'ברוכים הבאים לעת לעשות — ההרשמה אושרה',
          text: `ההרשמה שלכם אושרה. ברוכים הבאים לעת לעשות!\nלבחירת סיסמה: ${setup}\nהקישור אישי, חד־פעמי ותקף ל־24 שעות ממועד האישור. אין להעביר אותו לאחרים.\nלאחר בחירת הסיסמה יש להיכנס עם תעודת הזהות והסיסמה שבחרתם: ${login}\nאם הקישור פג או שלא ביקשתם להירשם, פנו למנהל הסניף.`,
          html: `<html lang="he" dir="rtl"><body style="font-family:Arial,sans-serif;text-align:right;line-height:1.7;color:#302633"><div style="max-width:560px;margin:auto;padding:24px"><h2>ברוכים הבאים לעת לעשות!</h2><p>ההרשמה שלכם אושרה. שמחים שאתם איתנו.</p><p>בחרו סיסמה אישית באמצעות הקישור המאובטח:</p><p><a href="${setup}" style="display:inline-block;background:#4d284f;color:white;padding:12px 24px;border-radius:8px">בחירת סיסמה</a></p><p>הקישור אישי, חד־פעמי ותקף ל־24 שעות ממועד האישור. אין להעביר אותו לאחרים.</p><p>לאחר בחירת הסיסמה, היכנסו עם תעודת הזהות והסיסמה שבחרתם.</p><p><a href="${login}">כניסה למערכת</a></p><p>אם הקישור פג או שלא ביקשתם להירשם, פנו למנהל הסניף.</p></div></body></html>`,
        });
        const accepted = result.accepted.some(
          (x) => x.toLowerCase() === row.recipient!.toLowerCase(),
        );
        if (!accepted) {
          await this.finish(row, 'FAILED', 'SMTP_REJECTED');
          return;
        }
        await this.finish(row, 'SENT', null, true);
      } catch {
        // No transport error, token, URL, body, recipient or password in logs.
        await this.finish(
          row,
          row.attempts >= 5 ? 'FAILED' : 'PENDING',
          'SMTP_UNAVAILABLE',
        );
        this.logger.warn(
          'Welcome email attempt failed; delivery state recorded',
        );
      }
    } catch {
      this.logger.warn('Welcome email worker unavailable; retry on next tick');
    } finally {
      this.running = false;
    }
  }
  private finish(
    row: Delivery,
    state: string,
    reason: string | null,
    purge = false,
  ) {
    return this.query(
      `UPDATE public.onboarding_deliveries SET status=:state,reason=:reason,
      token_ciphertext=CASE WHEN :purge THEN NULL ELSE token_ciphertext END,
      sent_at=CASE WHEN :state = 'SENT' THEN now() ELSE sent_at END,
      message_id=CASE WHEN :state = 'SENT' THEN :message ELSE message_id END,
      next_attempt_at=now()+(:delay * interval '1 minute'),claim_id=NULL,lease_until=NULL
      WHERE id=:id AND status='PROCESSING' AND claim_id=:claim AND revoked_at IS NULL AND consumed_at IS NULL`,
      {
        id: row.id,
        claim: row.claim_id,
        state,
        reason,
        purge,
        delay: Math.min(60, 2 ** row.attempts),
        message: `<welcome-${row.id}@${new URL(welcomeConfig().origin).hostname}>`,
      },
    );
  }
  async consume(token: string, password: string, confirmation: string) {
    if (!this.enabled()) throw new NotFoundException();
    if (!TOKEN_PATTERN.test(token)) throw this.invalid();
    if (password !== confirmation)
      throw new BadRequestException({
        code: 'PASSWORD_CONFIRMATION_MISMATCH',
        message: 'Passwords do not match',
      });
    const tokenHash = digest(token);
    const [found] = await this.query<Delivery>(
      'SELECT * FROM public.onboarding_deliveries WHERE token_hash=:hash',
      { hash: tokenHash },
    );
    if (
      !found ||
      found.revoked_at ||
      found.consumed_at ||
      !found.expires_at ||
      new Date(found.expires_at).getTime() <= Date.now()
    )
      throw this.invalid();
    // Password hashing is bounded and done outside locks, after a valid token lookup.
    const [identity] = await this.query<CredentialUser>(
      'SELECT id,national_id_hash,phone_number FROM public."user" WHERE id=:id',
      { id: found.user_id },
    );
    if (!identity) throw this.invalid();
    const normalized = validateNewPassword(password, {
      nationalIdHash: identity.national_id_hash,
      phoneNumber: identity.phone_number,
    });
    const passwordHash = await hashPassword(normalized);
    return this.db.transaction(async (t) => {
      // Match password-reset trigger lock order: user first, delivery second.
      const [user] = await this.query<CredentialUser>(
        'SELECT * FROM public."user" WHERE id=:id FOR UPDATE',
        { id: found.user_id },
        t,
      );
      const [row] = await this.query<Delivery>(
        'SELECT * FROM public.onboarding_deliveries WHERE id=:id FOR UPDATE',
        { id: found.id },
        t,
      );
      if (
        !user ||
        !row ||
        !user.is_active ||
        user.deletedAt ||
        !user.password_hash ||
        !user.must_change_password ||
        row.revoked_at ||
        row.consumed_at ||
        new Date(row.expires_at).getTime() <= Date.now() ||
        row.credential_hash !== digest(user.password_hash) ||
        !['PENDING', 'PROCESSING', 'SENT', 'FAILED'].includes(row.status)
      )
        throw this.invalid();
      const [role] = await this.query<{ ok: boolean }>(
        'SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE "userId"=:id AND "deletedAt" IS NULL) AS ok',
        { id: user.id },
        t,
      );
      if (!role?.ok) throw this.invalid();
      await this.query(
        `UPDATE public.onboarding_deliveries SET consumed_at=now(),token_ciphertext=NULL,
        status=CASE WHEN status='SENT' THEN status ELSE 'CANCELLED' END,reason='PASSWORD_SET',claim_id=NULL,lease_until=NULL
        WHERE id=:id`,
        { id: row.id },
        t,
      );
      await this.query(
        `UPDATE public."user" SET password_hash=:hash,password_changed_at=now(),must_change_password=false,
        temporary_password_expires_at=NULL,failed_login_attempts=0,locked_until=NULL,"updatedAt"=now() WHERE id=:id`,
        { id: user.id, hash: passwordHash },
        t,
      );
      return { ok: true };
    });
  }
  private invalid() {
    return new BadRequestException({
      code: 'SETUP_LINK_INVALID',
      message: 'Setup link is invalid or expired',
    });
  }
}
