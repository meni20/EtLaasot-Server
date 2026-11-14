import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { createHmac } from 'node:crypto';
import type { Request, Response } from 'express';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { getRequiredEnv } from '../../config/env.util';
import { getNationalIdDetails } from '../user/national-id.util';
import { safeDatabaseFailure } from '../../common/safe-database-failure';

@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  constructor(@InjectConnection() private readonly db: Sequelize) {}

  async canActivate(context: ExecutionContext) {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const identifier: unknown = request.body?.identifier;
    let identity: string | undefined;
    if (typeof identifier === 'string' && identifier.length <= 32) {
      try {
        identity = getNationalIdDetails(identifier).nationalIdHash;
      } catch {
        // Invalid identifiers still consume the shared budgets.
      }
    }

    // A Railway proxy can aggregate many clients behind one socket address.
    // Use a generous shared peer budget and never trust caller-supplied headers.
    const buckets: [string, number][] = [
      ['global', 3000],
      [`peer:${request.socket.remoteAddress ?? 'unknown'}`, 1000],
    ];
    if (identity) buckets.push([`identity:${identity}`, 12]);

    try {
      const secret = getRequiredEnv('JWT_SECRET');
      for (const [bucket, maximum] of buckets) {
        const key = createHmac('sha256', secret)
          .update(`etlaasot:main-login-limit:v1\0${bucket}`)
          .digest('hex');
        const [result] = await this.db.query<{
          attempts: number;
          retry: number;
        }>(
          `INSERT INTO public.registration_public_limits AS limits (key_hash, attempts, expires_at)
           VALUES ($key, 1, now() + interval '5 minutes')
           ON CONFLICT (key_hash) DO UPDATE SET
             attempts = CASE WHEN limits.expires_at <= now() THEN 1
                             ELSE LEAST(limits.attempts + 1, $cap::integer) END,
             expires_at = CASE WHEN limits.expires_at <= now()
                               THEN EXCLUDED.expires_at ELSE limits.expires_at END
           RETURNING attempts, GREATEST(1, CEIL(EXTRACT(EPOCH FROM expires_at - now())))::int AS retry`,
          {
            bind: { key, cap: maximum + 1 },
            type: QueryTypes.SELECT,
            logging: false,
          },
        );
        if (!result) throw new Error('Missing login limiter result');
        if (result.attempts > maximum) {
          response.setHeader('Retry-After', String(result.retry));
          throw new HttpException(
            'יותר מדי ניסיונות התחברות. נסו שוב בעוד מספר דקות.',
            429,
          );
        }
      }
      return true;
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 429)
        throw error;
      safeDatabaseFailure(error);
      throw new ServiceUnavailableException(
        'ההתחברות אינה זמינה כרגע. נסו שוב מאוחר יותר.',
      );
    }
  }
}
