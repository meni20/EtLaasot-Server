import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Request } from 'express';
import { AUTH_ROLES } from 'src/constants/auth.constants';
import { getOptionalEnv, isProduction } from 'src/config/env.util';
import { AuthorizationService } from '../auth/authorization.service';
import type { AuthUser } from '../auth/authorization.service';
import User from '../user/entities/user.entity';
import UserRole from '../user-role/enitites/user-role.entity';
import { DocumentType } from './trainee-document.constants';

export type DocumentRequest = Request & {
  user: AuthUser;
  documentTraineeUuid: string;
};

@Injectable()
export class TraineeDocumentAccessGuard implements CanActivate {
  constructor(private readonly authorization: AuthorizationService) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<DocumentRequest>();
    const target = req.params.traineeUuid;
    const type = req.params.documentType;
    if (
      type !== undefined &&
      !Object.values(DocumentType).includes(type as DocumentType)
    ) {
      throw new BadRequestException('Invalid document type');
    }
    if (
      target !== undefined &&
      (typeof target !== 'string' || !isUUID(target, '4'))
    ) {
      throw new BadRequestException('Invalid trainee UUID');
    }

    let traineeUuid: string;
    if (typeof target === 'string') {
      await this.authorization.assertAdminForUserUuid(req.user, target);
      traineeUuid = target;
    } else {
      const actor = this.authorization.getActorId(req.user);
      if (
        !actor ||
        !this.authorization.hasRole(req.user, AUTH_ROLES.TRAINEE.id)
      ) {
        throw new ForbiddenException('Trainee role is required');
      }
      traineeUuid = actor;
    }

    // Archived targets remain available to admins; Sequelize still excludes deleted users.
    const trainee = await User.findByPk(traineeUuid, {
      attributes: ['id'],
      include: [{ model: UserRole, attributes: ['roleId'] }],
    });
    if (!trainee) throw new NotFoundException('Trainee not found');
    if (
      !trainee.userRoles?.some(
        (role) => Number(role.roleId) === AUTH_ROLES.TRAINEE.id,
      )
    ) {
      throw new ForbiddenException('Target user must be a trainee');
    }

    // Cookie-authenticated multipart mutations need CSRF protection as well as CORS.
    if (
      ['PUT', 'DELETE'].includes(req.method) &&
      !/^Bearer\s+\S+$/i.test(req.headers.authorization ?? '')
    ) {
      const origins =
        getOptionalEnv('CORS_ORIGINS')
          ?.split(',')
          .map((origin) => origin.trim()) ??
        (isProduction()
          ? []
          : ['http://localhost:5173', 'http://localhost:5174']);
      if (!req.headers.origin || !origins.includes(req.headers.origin)) {
        throw new ForbiddenException('Trusted origin is required');
      }
    }
    req.documentTraineeUuid = traineeUuid;
    return true;
  }
}
