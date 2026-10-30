// Offline regression coverage: no real users, environment files or DB writes.
import { JwtService } from '@nestjs/jwt';
import { Sequelize } from 'sequelize-typescript';
import BranchService from '../branch/branch.service';
import UserRoleService from '../user-role/user-role.service';
import UserService from '../user/user.service';
import AuthService from './auth.service';
import { hashPassword } from './password.util';

describe('Normal authentication in local DEV integration', () => {
  const original = { ...process.env };
  const password = 'OfflineAdmin!4827';
  let passwordHash: string;
  beforeAll(async () => {
    passwordHash = await hashPassword(password);
  });
  beforeEach(() => {
    process.env.NATIONAL_ID_HASH_SECRET = 'offline-local-dev-hash-secret';
    process.env.PARENT_REGISTRATION_INTEGRATION_ENABLED = 'true';
    // Even a stale setting must not block normal users in the DEV system.
    process.env.PARENT_REGISTRATION_LOCAL_TEST_BRANCHES = 'phase5-old-fixture';
    delete process.env.RECAPTCHA_SECRET_KEY;
  });
  afterEach(() => {
    process.env = { ...original };
  });
  function setup() {
    const user = {
      id: 'offline-admin',
      branchId: 'branch-existing',
      isActive: true,
      passwordHash,
      mustChangePassword: false,
      temporaryPasswordExpiresAt: null as Date | null,
    };
    const users = {
      findByNationalIdHashForAuth: jest.fn().mockResolvedValue(user),
      findByIdForAuth: jest.fn().mockResolvedValue(user),
      clearLoginFailures: jest.fn().mockResolvedValue(undefined),
      registerFailedLogin: jest.fn().mockResolvedValue(undefined),
      updatePassword: jest.fn().mockResolvedValue(undefined),
    };
    const roles = {
      findRolesByUserId: jest
        .fn()
        .mockResolvedValue([{ roleId: 10000, resourceId: 'branch-existing' }]),
    };
    const jwt = { sign: jest.fn().mockReturnValue('offline-token') };
    const service = new AuthService(
      {} as Sequelize,
      roles as unknown as UserRoleService,
      users as unknown as UserService,
      {
        getAllBranches: jest
          .fn()
          .mockResolvedValue([
            { id: 'branch-existing', name: 'Offline branch' },
          ]),
      } as unknown as BranchService,
      jwt as unknown as JwtService,
    );
    return { service, user, users, roles, jwt };
  }
  it('allows an existing administrator in an ordinary branch with a valid password', async () => {
    const { service, users } = setup();
    await expect(service.login('123456782', password)).resolves.toMatchObject({
      token: 'offline-token',
      activeBranch: 'branch-existing',
    });
    expect(users.clearLoginFailures).toHaveBeenCalledWith('offline-admin');
  });
  it('allows an active global administrator without a primary branch', async () => {
    const { service, user, roles } = setup();
    Object.assign(user, { branchId: null });
    roles.findRolesByUserId.mockResolvedValue([
      { roleId: 10001, resourceId: '' },
    ]);
    await expect(service.login('123456782', password)).resolves.toMatchObject({
      token: 'offline-token',
    });
  });
  it('continues rejecting incorrect passwords and tracking failures', async () => {
    const { service, users, jwt } = setup();
    await expect(service.login('123456782', 'Incorrect!4827')).rejects.toThrow(
      'invalid credentials',
    );
    expect(users.registerFailedLogin).toHaveBeenCalled();
    expect(jwt.sign).not.toHaveBeenCalled();
  });
  it('continues rejecting inactive users', async () => {
    const { service, user, jwt } = setup();
    user.isActive = false;
    await expect(service.login('123456782', password)).rejects.toThrow(
      'invalid credentials',
    );
    expect(jwt.sign).not.toHaveBeenCalled();
  });
  it('continues rejecting users without roles', async () => {
    const { service, roles, jwt } = setup();
    roles.findRolesByUserId.mockResolvedValue([]);
    await expect(service.login('123456782', password)).rejects.toThrow(
      'invalid credentials',
    );
    expect(jwt.sign).not.toHaveBeenCalled();
  });
  it('continues rejecting expired temporary passwords', async () => {
    const { service, user, jwt } = setup();
    user.mustChangePassword = true;
    user.temporaryPasswordExpiresAt = new Date(Date.now() - 1000);
    await expect(service.login('123456782', password)).rejects.toThrow(
      'invalid credentials',
    );
    expect(jwt.sign).not.toHaveBeenCalled();
  });
  it('allows the existing password-change mechanism for an ordinary DEV user', async () => {
    const { service, users } = setup();
    await expect(
      service.changePassword(
        'offline-admin',
        password,
        'UpdatedOffline!4827',
        'UpdatedOffline!4827',
      ),
    ).resolves.toEqual({ ok: true });
    expect(users.updatePassword).toHaveBeenCalledWith(
      'offline-admin',
      expect.any(String),
      false,
      null,
    );
  });
});
