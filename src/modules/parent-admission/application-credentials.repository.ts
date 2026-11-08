import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { QueryTypes, type Transaction } from 'sequelize';

// Internal only. Never serialize this shape into an API response.
export type ApplicantCredential = {
  applicationId: string;
  nationalIdHash: string;
  passwordHash: string;
  loginEmail: string;
};

@Injectable()
export class ApplicationCredentialsRepository {
  constructor(@InjectConnection() private readonly db: Sequelize) {}

  private query<T extends object>(
    sql: string,
    replacements: Record<string, unknown>,
    transaction?: Transaction,
  ) {
    return this.db.query<T>(sql, {
      type: QueryTypes.SELECT,
      replacements,
      transaction,
      logging: false,
    });
  }

  async lockIdentity(hash: string, t: Transaction) {
    await this.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('application-identity:' || :hash,0))",
      { hash },
      t,
    );
  }

  async identityUnavailable(hash: string, t: Transaction) {
    const [row] = await this.query<{ unavailable: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM public."user" WHERE national_id_hash=:hash)
        OR EXISTS(SELECT 1 FROM public.trainee_applications WHERE national_id_hash=:hash) AS unavailable`,
      { hash },
      t,
    );
    return row.unavailable;
  }

  async create(input: ApplicantCredential, t: Transaction) {
    await this.query(
      `INSERT INTO public.application_credentials(application_id,national_id_hash,password_hash,login_email)
       VALUES(:applicationId,:nationalIdHash,:passwordHash,:loginEmail) RETURNING application_id`,
      input,
      t,
    );
  }

  async find(hash: string, t?: Transaction) {
    const [row] = await this.query<ApplicantCredential>(
      `SELECT application_id AS "applicationId",national_id_hash AS "nationalIdHash",
        password_hash AS "passwordHash",login_email AS "loginEmail"
        FROM public.application_credentials WHERE national_id_hash=:hash`,
      { hash },
      t,
    );
    return row;
  }

  async hasUser(hash: string, t: Transaction) {
    const [row] = await this.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM public."user" WHERE national_id_hash=:hash) AS exists',
      { hash },
      t,
    );
    return row.exists;
  }

  async session(
    applicationId: string,
    tokenHash: string,
    expiresAt: Date,
    t: Transaction,
  ) {
    // One active session per application, matching the existing applicant model.
    // Lock ordering matches recovery/save: session before application.
    await this.query(
      `INSERT INTO public.applicant_sessions(application_id,token_hash,expires_at,recovery_hash,recovery_expires_at)
       VALUES(:applicationId,:tokenHash,:expiresAt,NULL,NULL)
       ON CONFLICT(application_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,
         expires_at=EXCLUDED.expires_at,revoked_at=NULL,updated_at=now()
       RETURNING application_id`,
      { applicationId, tokenHash, expiresAt },
      t,
    );
  }

  async lockSession(applicationId: string, t: Transaction) {
    await this.query(
      'SELECT application_id FROM public.applicant_sessions WHERE application_id=:applicationId FOR UPDATE',
      { applicationId },
      t,
    );
  }
}
