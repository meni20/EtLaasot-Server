import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AuthorizationService, AuthUser } from '../auth/authorization.service';

@Injectable()
export class EventImageUploadGuard implements CanActivate {
  constructor(private readonly authorization: AuthorizationService) {}

  async canActivate(context: ExecutionContext) {
    const { params, user } = context
      .switchToHttp()
      .getRequest<
        Request<{ eventId?: string; branchId?: string }> & { user: AuthUser }
      >();

    if (params.eventId) {
      await this.authorization.assertAdminForEvent(user, params.eventId);
    } else {
      this.authorization.assertAdminForBranch(user, params.branchId ?? '');
    }
    return true;
  }
}
