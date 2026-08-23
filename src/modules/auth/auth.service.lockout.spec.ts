import { JwtService } from '@nestjs/jwt';
import { Sequelize } from 'sequelize-typescript';
import BranchService from '../branch/branch.service';
import UserRoleService from '../user-role/user-role.service';
import UserService from '../user/user.service';
import AuthService from './auth.service';

type LoginUser = {
  id: string;
  isActive?: boolean | null;
  failedLoginAttempts?: number | null;
  lockedUntil?: Date | string | null;
};

type AuthServiceLockoutInternals = {
  assertLoginAllowed(user: LoginUser): Promise<void>;
  registerFailedLogin(user: LoginUser): Promise<void>;
};

describe('AuthService repeated login failures', () => {
  const originalHashSecret = process.env.NATIONAL_ID_HASH_SECRET;

  beforeAll(() => {
    process.env.NATIONAL_ID_HASH_SECRET = 'test-national-id-hash-secret';
  });

  afterAll(() => {
    if (originalHashSecret === undefined) {
      delete process.env.NATIONAL_ID_HASH_SECRET;
    } else {
      process.env.NATIONAL_ID_HASH_SECRET = originalHashSecret;
    }
  });

  const createService = () => {
    const userService = {
      registerFailedLogin: jest.fn().mockResolvedValue(undefined),
      clearLoginFailures: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AuthService(
      {} as Sequelize,
      {} as UserRoleService,
      userService as unknown as UserService,
      {} as BranchService,
      {} as JwtService,
    );

    return {
      internals: service as unknown as AuthServiceLockoutInternals,
      userService,
    };
  };

  it('does not block a user with a previously persisted lock timestamp', async () => {
    const { internals, userService } = createService();

    await expect(
      internals.assertLoginAllowed({
        id: 'user-1',
        isActive: true,
        failedLoginAttempts: 12,
        lockedUntil: new Date(Date.now() + 60_000),
      }),
    ).resolves.toBeUndefined();
    expect(userService.clearLoginFailures).not.toHaveBeenCalled();
  });

  it('continues tracking failures without creating a lock', async () => {
    const { internals, userService } = createService();
    const user: LoginUser = {
      id: 'user-1',
      failedLoginAttempts: 4,
      lockedUntil: new Date(Date.now() + 60_000),
    };

    await internals.registerFailedLogin(user);

    expect(user.failedLoginAttempts).toBe(5);
    expect(user.lockedUntil).toBeNull();
    expect(userService.registerFailedLogin).toHaveBeenCalledWith(
      'user-1',
      5,
      null,
    );
  });
});
