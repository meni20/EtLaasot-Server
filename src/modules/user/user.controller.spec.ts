import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AuthorizationService } from '../auth/authorization.service';
import UserController from './user.controller';
import UserService from './user.service';

describe('UserController self profile update', () => {
  const updateCurrentUserProfile = jest.fn();
  const controller = new UserController(
    { updateCurrentUserProfile } as unknown as UserService,
    {} as AuthorizationService,
  );

  beforeEach(() => {
    updateCurrentUserProfile.mockReset();
  });

  it('updates shirt size for the authenticated user only', async () => {
    updateCurrentUserProfile.mockResolvedValue({
      id: 'authenticated-user',
      shirtSize: 'M',
    });

    await expect(
      controller.updateMe(
        { shirtSize: 'M', customShirtSize: null },
        { user: { userId: 'authenticated-user' } },
      ),
    ).resolves.toEqual({ id: 'authenticated-user', shirtSize: 'M' });

    expect(updateCurrentUserProfile).toHaveBeenCalledWith(
      'authenticated-user',
      { shirtSize: 'M', customShirtSize: null },
    );
  });

  it('updates allergies for the authenticated user only', async () => {
    updateCurrentUserProfile.mockResolvedValue({
      id: 'authenticated-user',
      allergies: 'Peanuts',
    });

    await expect(
      controller.updateMe(
        { allergies: 'Peanuts' },
        { user: { userId: 'authenticated-user' } },
      ),
    ).resolves.toEqual({ id: 'authenticated-user', allergies: 'Peanuts' });

    expect(updateCurrentUserProfile).toHaveBeenCalledWith(
      'authenticated-user',
      { allergies: 'Peanuts' },
    );
  });

  it('continues to reject fields outside the self-update whitelist', () => {
    expect(() =>
      controller.updateMe(
        { shirtSize: 'L', branchId: 'another-branch' } as never,
        { user: { userId: 'authenticated-user' } },
      ),
    ).toThrow(BadRequestException);
  });
});

describe('Trainee directory scope', () => {
  const getAllTrainees = jest.fn();
  const controller = new UserController(
    { getAllTrainees } as never,
    new AuthorizationService(),
  );
  const request = {
    user: {
      roles: [
        { roleId: 10000, branchId: 'admin-branch' },
        { roleId: 1, branchId: 'volunteer-branch' },
      ],
    },
  };

  it('keys access and archived data to the requested branch role', () => {
    controller.getAllTrainees('volunteer-branch', 'active', request);
    expect(getAllTrainees).toHaveBeenLastCalledWith(
      'volunteer-branch',
      false,
      false,
      'active',
      false,
    );
    expect(() =>
      controller.getAllTrainees('volunteer-branch', 'all', request),
    ).toThrow();
    expect(() =>
      controller.getAllTrainees('other-branch', 'active', request),
    ).toThrow();
    controller.getAllTrainees('admin-branch', 'archived', request);
    expect(getAllTrainees).toHaveBeenLastCalledWith(
      'admin-branch',
      true,
      true,
      'archived',
      true,
    );
  });
});

describe('Super admin branch manager management', () => {
  const getBranchManagers = jest.fn();
  const removeBranchAdminRole = jest.fn();
  const controller = new UserController(
    { getBranchManagers, removeBranchAdminRole } as never,
    new AuthorizationService(),
  );
  const actorId = randomUUID();
  const managerId = randomUUID();
  const superRequest = {
    user: { userId: actorId, roles: [{ roleId: 10001 }] },
  };
  const branchAdminRequest = {
    user: { userId: randomUUID(), roles: [{ roleId: 10000, resourceId: 'a' }] },
  };

  beforeEach(() => {
    getBranchManagers.mockReset();
    removeBranchAdminRole.mockReset();
  });

  it('lists and removes branch managers only for a super admin', async () => {
    getBranchManagers.mockResolvedValue([]);
    removeBranchAdminRole.mockResolvedValue({ id: managerId });
    await expect(controller.getBranchManagers(superRequest)).resolves.toEqual([]);
    await expect(
      controller.removeBranchAdminRole(managerId, superRequest),
    ).resolves.toEqual({ id: managerId });
    expect(removeBranchAdminRole).toHaveBeenCalledWith(managerId, actorId);
    expect(() => controller.getBranchManagers(branchAdminRequest)).toThrow();
    expect(() =>
      controller.removeBranchAdminRole(managerId, branchAdminRequest),
    ).toThrow();
  });
});
