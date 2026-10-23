import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  SetMetadata,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { getBooleanEnv } from '../../config/env.util';
import type { AuthUser } from '../auth/authorization.service';

const REGISTRATION_ESSENTIAL = 'registration:essential';
export const AllowRegistrationAccess = () =>
  SetMetadata(REGISTRATION_ESSENTIAL, true);
export function onlyTrainee(user: AuthUser) {
  const roles = user.roles ?? [];
  return (
    roles.some((r) => r.roleId === 2) &&
    !roles.some((r) => [1, 10000, 10001].includes(r.roleId))
  );
}
@Injectable()
export class RegistrationRequestAccess {
  constructor(@InjectConnection() private readonly db: Sequelize) {}
  async assertRequest(ctx: ExecutionContext) {
    if (!getBooleanEnv('PARENT_REGISTRATION_BLOCKING_ENABLED', false)) return;
    const req = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
    if (!onlyTrainee(req.user)) return;
    if (
      Reflect.getMetadata(REGISTRATION_ESSENTIAL, ctx.getHandler()) ||
      Reflect.getMetadata(REGISTRATION_ESSENTIAL, ctx.getClass())
    )
      return;
    if (!getBooleanEnv('PARENT_REGISTRATION_ENABLED', false))
      throw new ServiceUnavailableException(
        'Registration restriction configuration is incomplete',
      );
    let row: { required: boolean } | undefined;
    try {
      [row] = await this.db.query<{ required: boolean }>(
        `
        SELECT EXISTS (
          SELECT 1 FROM public.branch_registration_periods p
          JOIN public.activity_years y ON y.id=p.activity_year_id
          JOIN public."user" u ON u."branchId"=p.branch_id
          WHERE u.id=:userId AND p.status='OPEN' AND y.is_active
            AND (now() AT TIME ZONE 'UTC')::date BETWEEN y.starts_on AND y.ends_on
            AND NOT EXISTS (SELECT 1 FROM public.registration_forms f WHERE f.trainee_uuid=u.id
              AND f.branch_id=p.branch_id AND f.activity_year_id=y.id AND f.request_type='YEARLY' AND f.status='APPROVED')
            ${getBooleanEnv('PARENT_ADMISSION_SCHEMA_READY', false) ? `AND NOT EXISTS (SELECT 1 FROM public.trainee_applications a WHERE a.provisioned_user_id=u.id AND a.branch_id=p.branch_id AND a.approved_activity_year_id=y.id AND a.status='APPROVED')` : ''}
        ) OR EXISTS (
          SELECT 1 FROM public.registration_forms f WHERE f.trainee_uuid=:userId AND f.blocks_access
            AND f.status IN ('DRAFT','PENDING_REVIEW','CHANGES_REQUESTED')
        ) AS required`,
        {
          replacements: { userId: req.user.userId ?? req.user.sub },
          type: QueryTypes.SELECT,
          logging: false,
        },
      );
    } catch {
      throw new ServiceUnavailableException({
        code: 'REGISTRATION_STATUS_UNAVAILABLE',
        message: 'Registration access could not be verified',
      });
    }
    if (!row)
      throw new ServiceUnavailableException(
        'Registration access could not be verified',
      );
    if (row.required)
      throw new ForbiddenException({
        code: 'PARENT_REGISTRATION_REQUIRED',
        message: 'Current registration approval is required',
      });
  }
}
