import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUTH_ROLES } from 'src/constants/auth.constants';
import DashboardController from './dashboard.controller';
import { RolesGuard } from '../auth/guards/roles.guard';

const createContext = (roleId: number): ExecutionContext =>
  ({
    getHandler: () => DashboardController.prototype.getSuperAdminDashboard,
    getClass: () => DashboardController,
    switchToHttp: () => ({
      getRequest: () => ({ user: { roles: [{ roleId }] } }),
    }),
  }) as unknown as ExecutionContext;

describe('DashboardController authorization', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows a Super Admin', () => {
    expect(guard.canActivate(createContext(AUTH_ROLES.SUPER_ADMIN.id))).toBe(
      true,
    );
  });

  it('rejects a regular branch Admin', () => {
    expect(guard.canActivate(createContext(AUTH_ROLES.BRANCH_ADMIN.id))).toBe(
      false,
    );
  });
});
