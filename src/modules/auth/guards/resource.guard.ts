import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class ResourceGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const requiredId = this.reflector.get<number>(
      'resourceId',
      ctx.getHandler(),
    );

    if (!requiredId) return true;

    const req = ctx.switchToHttp().getRequest();

    const resources = req.user?.resources || [];

    return resources.some((r) => r.resourceId === requiredId);
  }
}
