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
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const RECOVERY_CODE_PATTERN =
  /^(?:[A-Za-z0-9_-]{43}|[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{16})$/;
// Sixteen independent base-32 symbols: 80 bits of CSPRNG entropy, without
// modulo bias (32 divides 256). Session tokens retain their existing 256 bits.
export function applicantRecoveryCode() {
  const code = Array.from(
    randomBytes(16),
    (byte) => RECOVERY_ALPHABET[byte & 31],
  ).join('');
  return code.match(/.{4}/g)!.join('-');
}
export function normalizeRecoveryCode(value: string) {
  const trimmed = value.trim();
  // Legacy credentials are case-sensitive; never uppercase or strip them.
  if (/^[A-Za-z0-9_-]{43}$/.test(trimmed)) return trimmed;
  return trimmed.replace(/[\s-]/g, '').toUpperCase();
}
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
  const normalized = kind === 'recovery' ? normalizeRecoveryCode(value) : value;
  if (
    !(kind === 'recovery' ? RECOVERY_CODE_PATTERN : /^[A-Za-z0-9_-]{43}$/).test(
      normalized,
    )
  )
    throw new UnauthorizedException(
      'Applicant credential is invalid or expired',
    );
  return admissionHash(kind, normalized);
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
