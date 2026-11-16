import { randomUUID } from 'crypto';
import UserRole from '../user-role/enitites/user-role.entity';
import User from './entities/user.entity';
import UserRepository from './user.repository';

describe('Branch manager role removal', () => {
  const userId = randomUUID();
  const transaction = { LOCK: { UPDATE: 'UPDATE' } } as never;
  const user = {
    id: userId,
    name: 'Synthetic Manager',
    branchId: 'synthetic-branch',
    isActive: true,
  };

  afterEach(() => jest.restoreAllMocks());

  it('restores the historical volunteer role and keeps the account', async () => {
    const branchAdmin = {
      roleId: 10000,
      deletedAt: null,
      destroy: jest.fn(),
    };
    const volunteer = {
      roleId: 1,
      deletedAt: new Date(),
      restore: jest.fn(async function (this: any) {
        this.deletedAt = null;
      }),
      update: jest.fn(),
    };
    jest.spyOn(User, 'findByPk').mockResolvedValue(user as never);
    jest
      .spyOn(UserRole, 'findAll')
      .mockResolvedValue([branchAdmin, volunteer] as never);
    const create = jest.spyOn(UserRole, 'create');
    const result = await new UserRepository().removeBranchAdminRole(
      userId,
      randomUUID(),
      transaction,
    );
    expect(volunteer.restore).toHaveBeenCalled();
    expect(volunteer.update).toHaveBeenCalled();
    expect(branchAdmin.destroy).toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: userId, restoredRoleId: 1 });
  });

  it('protects any account that also holds the super-admin role', async () => {
    const branchAdmin = { roleId: 10000, deletedAt: null, destroy: jest.fn() };
    jest.spyOn(User, 'findByPk').mockResolvedValue(user as never);
    jest.spyOn(UserRole, 'findAll').mockResolvedValue([
      branchAdmin,
      { roleId: 10001, deletedAt: null },
    ] as never);
    await expect(
      new UserRepository().removeBranchAdminRole(
        userId,
        randomUUID(),
        transaction,
      ),
    ).rejects.toMatchObject({ response: { code: 'SUPER_ADMIN_PROTECTED' } });
    expect(branchAdmin.destroy).not.toHaveBeenCalled();
  });
});
