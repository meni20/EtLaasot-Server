import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AUTH_ROLES } from 'src/constants/auth.constants';

@Injectable()
export class BranchGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.roles) return false;

    const branchId =
      request.params.branchId ||
      request.body?.branchId ||
      request.query?.branchId;

    // SUPER_ADMIN always passes
    if (user.roles.some((r: any) => r.roleId === AUTH_ROLES.SUPER_ADMIN.id)) {
      return true;
    }

    // If no branchId required, allow
    if (!branchId) return true;

    // Check user has permission for this branch
    return user.roles.some((r: any) => r.branchId === branchId);
  }
}
