import { AUTH_ROLES } from '../../constants/auth.constants';
import { isUUID } from 'class-validator';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { QueryTypes, Transaction } from 'sequelize';
import { randomUUID } from 'crypto';
import { EmailService } from '../email/email.service';
import { AuthorizationService, AuthUser } from '../auth/authorization.service';
import { getNationalIdDetails } from '../user/national-id.util';
import { hashPassword, validateNewPassword } from '../auth/password.util';
import { normalizeApplicantEmail } from './application-credentials.dto';
import { applicantToken } from './admission.security';
import { digest, TOKEN_PATTERN, welcomeConfig } from './welcome.security';

type Subject = {
  kind: 'USER' | 'APPLICATION';
  id: string;
  applicationId: string | null;
  hash: string;
  passwordHash: string;
  email: string | null;
  phone: string | null;
  branchId: string | null;
  active: boolean;
};
type Binding = {
  application_id: string | null;
  user_id: string | null;
  recipient: string;
  revision: string;
  bound_at: Date | null;
  authorized_until: Date;
};
type Challenge = {
  token_digest: string;
  national_id_hash: string;
  application_id: string | null;
  user_id: string | null;
  recipient: string;
  binding_revision: string;
  credential_digest: string;
  expires_at: Date;
  created_at: Date;
  consumed_at: Date | null;
  revoked_at: Date | null;
};
export const RESET_REQUEST_RESPONSE = { ok: true };

@Injectable()
export class PasswordRecoveryService {
  constructor(
    @InjectConnection() private readonly db: Sequelize,
    private readonly email: EmailService,
    private readonly auth: AuthorizationService,
  ) {}
  private q<T extends object = Record<string, unknown>>(
    sql: string,
    replacements: Record<string, unknown> = {},
    transaction?: Transaction,
  ) {
    return this.db.query<T>(sql, {
      replacements,
      transaction,
      type: QueryTypes.SELECT,
      logging: false,
    });
  }
  private async subject(
    hash: string,
    t?: Transaction,
  ): Promise<Subject | undefined> {
    const [user] = await this.q<Subject>(
      `SELECT 'USER' AS kind,u.id,a.id AS "applicationId",u.national_id_hash AS hash,u.password_hash AS "passwordHash",
      COALESCE(c.login_email,u.email) AS email,u.phone_number AS phone,u."branchId" AS "branchId",(u.is_active AND u."deletedAt" IS NULL) AS active
      FROM public."user" u LEFT JOIN public.trainee_applications a ON a.provisioned_user_id=u.id AND a.status='APPROVED'
      LEFT JOIN public.application_credentials c ON c.application_id=a.id WHERE u.national_id_hash=:hash`,
      { hash },
      t,
    );
    if (user) return user;
    const [app] = await this.q<Subject>(
      `SELECT 'APPLICATION' AS kind,a.id,a.id AS "applicationId",c.national_id_hash AS hash,c.password_hash AS "passwordHash",
      c.login_email AS email,COALESCE(a.draft_data#>>'{trainee,phone}',a.draft_data#>>'{volunteer,phone}') AS phone,a.branch_id AS "branchId",true AS active
      FROM public.application_credentials c JOIN public.trainee_applications a ON a.id=c.application_id
      WHERE c.national_id_hash=:hash AND a.status<>'APPROVED' AND a.provisioned_user_id IS NULL AND a.deletion_requested_at IS NULL`,
      { hash },
      t,
    );
    return app;
  }
  private async lock(s: Subject, t: Transaction) {
    // Match approval/login/recovery: applicant session -> application -> user.
    if (s.applicationId) {
      await this.q(
        'SELECT application_id FROM public.applicant_sessions WHERE application_id=:id FOR UPDATE',
        { id: s.applicationId },
        t,
      );
      await this.q(
        'SELECT id FROM public.trainee_applications WHERE id=:id FOR UPDATE',
        { id: s.applicationId },
        t,
      );
    }
    if (s.kind === 'USER')
      await this.q(
        'SELECT id FROM public."user" WHERE id=:id FOR UPDATE',
        { id: s.id },
        t,
      );
    const current = await this.subject(s.hash, t);
    return current?.kind === s.kind &&
      current.id === s.id &&
      current.active &&
      current.passwordHash
      ? current
      : undefined;
  }
  private async binding(s: Subject, t: Transaction, issuedAt?: Date) {
    const [b] = await this.q<Binding>(
      'SELECT * FROM public.password_recovery_bindings WHERE national_id_hash=:hash FOR UPDATE',
      { hash: s.hash },
      t,
    );
    if (!b || !s.email || b.recipient !== normalizeApplicantEmail(s.email))
      return;
    // An application binding follows only its server-approved account association.
    if (
      b.user_id
        ? s.kind !== 'USER' || b.user_id !== s.id
        : b.application_id !== s.applicationId
    )
      return;
    if (
      !b.bound_at &&
      new Date(b.authorized_until).getTime() <=
        (issuedAt ? new Date(issuedAt).getTime() : Date.now())
    )
      return;
    return b;
  }
  async authorize(
    actor: AuthUser,
    input: {
      subjectType: 'USER' | 'APPLICATION' | 'IDENTITY';
      subjectId: string;
      identityVerified: boolean;
      emailConfirmed: boolean;
      email: string;
    },
  ) {
    if (input.identityVerified !== true || input.emailConfirmed !== true)
      throw new BadRequestException(
        'Independent identity and registered mailbox authorization required',
      );
    const adminRole = actor.roles?.find(
      (role) => role.roleId === AUTH_ROLES.BRANCH_ADMIN.id,
    );
    this.auth.assertAdminForRequestedBranch(
      actor,
      adminRole?.branchId ?? adminRole?.resourceId,
    );
    let identity: { hash: string } | undefined;
    if (input.subjectType === 'IDENTITY')
      identity = { hash: getNationalIdDetails(input.subjectId).nationalIdHash };
    else {
      if (!isUUID(input.subjectId, 4))
        throw new BadRequestException('Invalid subject');
      const table =
        input.subjectType === 'USER' ? '"user"' : 'trainee_applications';
      [identity] = await this.q<{ hash: string }>(
        `SELECT national_id_hash AS hash FROM public.${table} WHERE id=:id`,
        { id: input.subjectId },
      );
    }
    if (!identity?.hash) throw new NotFoundException();
    const hint = await this.subject(identity.hash);
    if (!hint) throw new NotFoundException();
    return this.db.transaction(async (t) => {
      const s = await this.lock(hint, t);
      if (!s)
        throw new ConflictException('Account changed; reload before verifying');
      // Also protects approved users whose highest role forbids branch-manager resets.
      if (s.kind === 'USER') await this.auth.assertAdminForUser(actor, s.id);
      else
        this.auth.assertAdminForRequestedBranch(actor, s.branchId ?? undefined);
      const manager = this.auth.getActorId(actor);
      if (!manager) throw new NotFoundException();
      if (s.kind === 'USER' && s.id === manager)
        throw new BadRequestException(
          'A different manager must verify ownership',
        );
      const recipient = normalizeApplicantEmail(s.email);
      if (normalizeApplicantEmail(input.email) !== recipient)
        throw new ConflictException(
          'Verified mailbox does not match registered mailbox',
        );
      await this.q(
        `INSERT INTO public.password_recovery_bindings(national_id_hash,application_id,user_id,recipient,revision,authorized_by,authorized_until)
        VALUES(:hash,:app,:user,:recipient,:revision,:manager,now()+interval '30 minutes')
        ON CONFLICT(national_id_hash) DO UPDATE SET application_id=EXCLUDED.application_id,user_id=EXCLUDED.user_id,recipient=EXCLUDED.recipient,
          revision=EXCLUDED.revision,authorized_by=EXCLUDED.authorized_by,authorized_at=now(),authorized_until=EXCLUDED.authorized_until,bound_at=NULL
        RETURNING national_id_hash`,
        {
          hash: s.hash,
          app: s.kind === 'APPLICATION' ? s.id : null,
          user: s.kind === 'USER' ? s.id : null,
          recipient,
          revision: randomUUID(),
          manager,
        },
        t,
      );
      await this.revoke(s.hash, t);
      return {
        ok: true,
        recipient: recipient.replace(/^(.).*(@.*)$/, '$1***$2'),
      };
    });
  }
  private revoke(hash: string, t: Transaction) {
    return this.q(
      `UPDATE public.password_reset_challenges SET revoked_at=now() WHERE national_id_hash=:hash AND consumed_at IS NULL AND revoked_at IS NULL RETURNING token_digest`,
      { hash },
      t,
    );
  }
  async request(identifier: string) {
    // Eligibility, missing users, unbound mailboxes and transport failures share a response.
    try {
      const hash = getNationalIdDetails(identifier).nationalIdHash,
        hint = await this.subject(hash);
      if (!hint) return RESET_REQUEST_RESPONSE;
      const config = welcomeConfig();
      const delivery = await this.db.transaction(async (t) => {
        const s = await this.lock(hint, t);
        if (!s) return;
        const b = await this.binding(s, t);
        if (!b) return;
        if (!config.production && !config.recipients.includes(b.recipient))
          return;
        const token = applicantToken();
        await this.revoke(hash, t);
        await this.q(
          `INSERT INTO public.password_reset_challenges(token_digest,national_id_hash,application_id,user_id,recipient,binding_revision,credential_digest)
          VALUES(:token,:hash,:app,:user,:recipient,:revision,:credential) RETURNING token_digest`,
          {
            token: digest(token),
            hash,
            app: s.kind === 'APPLICATION' ? s.id : null,
            user: s.kind === 'USER' ? s.id : null,
            recipient: b.recipient,
            revision: b.revision,
            credential: digest(s.passwordHash),
          },
          t,
        );
        return { token, recipient: b.recipient };
      });
      if (delivery) {
        // Raw token lives only in memory and the recipient email. Never in SQL/logs.
        const link = `${config.origin}/reset-password#token=${delivery.token}`;
        void this.email
          .sendEmail({
            to: delivery.recipient,
            subject: 'עת לעשות — איפוס סיסמה',
            text: `לבחירת סיסמה חדשה: ${link}\nהקישור אישי, חד־פעמי ותקף ל־30 דקות. אם לא ביקשתם איפוס, התעלמו מההודעה.`,
            html: `<html lang="he" dir="rtl"><body><p>לבחירת סיסמה חדשה:</p><p><a href="${link}">איפוס סיסמה</a></p><p>הקישור אישי, חד־פעמי ותקף ל־30 דקות. אם לא ביקשתם איפוס, התעלמו מההודעה.</p></body></html>`,
          })
          .catch(() => {});
      }
    } catch {
      /* Never propagate ORM/SMTP errors that may contain bound credentials or tokens. */
    }
    return RESET_REQUEST_RESPONSE;
  }
  private invalid() {
    return new BadRequestException({
      code: 'RESET_LINK_INVALID',
      message: 'Reset link is invalid or expired',
    });
  }
  async consume(token: string, password: string, confirmation: string) {
    if (!TOKEN_PATTERN.test(token)) throw this.invalid();
    if (typeof password !== 'string' || password !== confirmation)
      throw new BadRequestException({
        code: 'PASSWORD_CONFIRMATION_MISMATCH',
        message: 'Passwords do not match',
      });
    const [found] = await this.q<Challenge>(
      'SELECT * FROM public.password_reset_challenges WHERE token_digest=:token',
      { token: digest(token) },
    );
    if (
      !found ||
      found.consumed_at ||
      found.revoked_at ||
      new Date(found.expires_at).getTime() <= Date.now()
    )
      throw this.invalid();
    const hint = await this.subject(found.national_id_hash);
    if (!hint) throw this.invalid();
    const next = await hashPassword(
      validateNewPassword(password, {
        nationalIdHash: hint.hash,
        phoneNumber: hint.phone,
      }),
    );
    return this.db.transaction(async (t) => {
      const s = await this.lock(hint, t);
      if (!s) throw this.invalid();
      const b = await this.binding(s, t, found.created_at);
      const [row] = await this.q<Challenge>(
        'SELECT * FROM public.password_reset_challenges WHERE token_digest=:token FOR UPDATE',
        { token: digest(token) },
        t,
      );
      if (
        !b ||
        !row ||
        row.consumed_at ||
        row.revoked_at ||
        new Date(row.expires_at).getTime() <= Date.now() ||
        row.binding_revision !== b.revision ||
        row.recipient !== b.recipient ||
        row.credential_digest !== digest(s.passwordHash) ||
        (s.kind === 'USER' ? row.user_id !== s.id : row.application_id !== s.id)
      )
        throw this.invalid();
      if (s.kind === 'APPLICATION')
        await this.q(
          `UPDATE public.application_credentials SET password_hash=:next,password_changed_at=now(),updated_at=now() WHERE application_id=:id RETURNING application_id`,
          { id: s.id, next },
          t,
        );
      else {
        await this.q(
          `UPDATE public."user" SET password_hash=:next,password_changed_at=now(),must_change_password=false,temporary_password_expires_at=NULL,failed_login_attempts=0,locked_until=NULL,"updatedAt"=now() WHERE id=:id RETURNING id`,
          { id: s.id, next },
          t,
        );
        await this.q(
          `INSERT INTO public.password_reset_session_revisions(user_id,revision) VALUES(:id,1) ON CONFLICT(user_id) DO UPDATE SET revision=password_reset_session_revisions.revision+1 RETURNING revision`,
          { id: s.id },
          t,
        );
      }
      if (s.applicationId)
        await this.q(
          `UPDATE public.applicant_sessions SET revoked_at=now(),updated_at=now() WHERE application_id=:id RETURNING application_id`,
          { id: s.applicationId },
          t,
        );
      await this.q(
        'UPDATE public.password_recovery_bindings SET bound_at=COALESCE(bound_at,now()) WHERE national_id_hash=:hash RETURNING national_id_hash',
        { hash: s.hash },
        t,
      );
      await this.q(
        'UPDATE public.password_reset_challenges SET consumed_at=now() WHERE token_digest=:token RETURNING token_digest',
        { token: row.token_digest },
        t,
      );
      await this.revoke(s.hash, t);
      return { ok: true };
    });
  }
}
