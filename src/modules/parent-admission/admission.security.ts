import {
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, randomBytes } from 'crypto';
import { getRequiredEnv } from '../../config/env.util';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { QueryTypes } from 'sequelize';

export const applicantToken = () => randomBytes(32).toString('base64url');
export function admissionHash(purpose: string, value: string) {
  const pepper = getRequiredEnv('PARENT_REGISTRATION_TOKEN_PEPPER');
  if (!/^[0-9a-f]{64}$/i.test(pepper))
    throw new ServiceUnavailableException(
      'Applicant security is not configured',
    );
  return createHmac('sha256', Buffer.from(pepper, 'hex'))
    .update(`${purpose}\0${value}`)
    .digest('hex');
}
export function credentialHash(kind: 'session' | 'recovery', value: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value))
    throw new UnauthorizedException(
      'Applicant credential is invalid or expired',
    );
  return admissionHash(kind, value);
}

@Injectable()
export class AdmissionRateLimiter {
  constructor(@InjectConnection() private readonly db: Sequelize) {}
  async consume(action: string, peer: string, identity?: string) {
    // Never use client-controlled X-Forwarded-For. Behind an unconfigured proxy
    // peers intentionally share the conservative socket-IP budget (fail closed).
    const keys: [string, number][] = [
      ['global', action === 'session' ? 6000 : 600],
      [`peer:${peer}`, action === 'session' ? 300 : 30],
    ];
    if (identity) keys.push([`identity:${identity}`, 8]);
    try {
      for (const [key, limit] of keys) {
        const [row] = await this.db.query<{ attempts: number }>(
          `
        INSERT INTO public.registration_public_limits(key_hash,attempts,expires_at)
        VALUES(:key,1,now()+interval '10 minutes')
        ON CONFLICT(key_hash) DO UPDATE SET
          attempts=CASE WHEN registration_public_limits.expires_at <= now() THEN 1 ELSE LEAST(registration_public_limits.attempts,2147483646)+1 END,
          expires_at=CASE WHEN registration_public_limits.expires_at <= now() THEN now()+interval '10 minutes' ELSE registration_public_limits.expires_at END
        RETURNING attempts`,
          {
            replacements: { key: admissionHash(`limit:${action}`, key) },
            type: QueryTypes.SELECT,
            logging: false,
          },
        );
        if (!row || row.attempts > limit)
          throw new HttpException(
            {
              code: 'REGISTRATION_RATE_LIMITED',
              message: 'Please try again later',
            },
            429,
          );
      }
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        'Registration abuse controls are unavailable',
      );
    }
  }
}
