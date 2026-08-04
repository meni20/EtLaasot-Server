import { BadRequestException } from '@nestjs/common';
import AuthorizationService from '../auth/authorization.service';
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
