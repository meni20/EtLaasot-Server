import { JwtService } from '@nestjs/jwt';
import { Sequelize } from 'sequelize-typescript';
import BranchService from '../branch/branch.service';
import UserRoleService from '../user-role/user-role.service';
import UserService from '../user/user.service';
import AuthService from './auth.service';

describe('AuthService performance', () => {
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

  it('coalesces an authenticated request burst into one SQL query', async () => {
    const query = jest.fn().mockResolvedValue([
      {
        userId: 'user-1',
        name: 'Test User',
        nationalIdLast4: '6782',
        mustChangePassword: false,
        fallbackBranchId: 'branch-bat-yam',
        roles: [
          {
            roleId: 2,
            resourceId: 'branch-bat-yam',
            branchName: 'Database branch name',
          },
        ],
      },
    ]);
    const service = new AuthService(
      { query } as unknown as Sequelize,
      {} as UserRoleService,
      {} as UserService,
      {} as BranchService,
      {} as JwtService,
    );

    const results = await Promise.all(
      Array.from({ length: 12 }, () => service.getMe('user-1')),
    );

    expect(query).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(12);
    expect(results[0]).toEqual(
      expect.objectContaining({
        userId: 'user-1',
        name: 'Test User',
        activeBranch: 'branch-bat-yam',
      }),
    );
  });
});
