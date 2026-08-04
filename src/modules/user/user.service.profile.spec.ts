import { Sequelize } from 'sequelize-typescript';
import UserRoleService from '../user-role/user-role.service';
import UserRepository from './user.repository';
import UserService from './user.service';

describe('UserService self profile allergies', () => {
  const originalHashSecret = process.env.NATIONAL_ID_HASH_SECRET;
  const originalEncryptionKey = process.env.NATIONAL_ID_ENCRYPTION_KEY;
  const updateProfile = jest.fn();
  let service: UserService;

  beforeAll(() => {
    process.env.NATIONAL_ID_HASH_SECRET = 'test-national-id-hash-secret';
    process.env.NATIONAL_ID_ENCRYPTION_KEY = '0'.repeat(64);
  });

  beforeEach(() => {
    updateProfile.mockReset();
    service = new UserService(
      {} as Sequelize,
      { updateProfile } as unknown as UserRepository,
      {} as UserRoleService,
    );
  });

  afterAll(() => {
    if (originalHashSecret === undefined) {
      delete process.env.NATIONAL_ID_HASH_SECRET;
    } else {
      process.env.NATIONAL_ID_HASH_SECRET = originalHashSecret;
    }

    if (originalEncryptionKey === undefined) {
      delete process.env.NATIONAL_ID_ENCRYPTION_KEY;
    } else {
      process.env.NATIONAL_ID_ENCRYPTION_KEY = originalEncryptionKey;
    }
  });

  it('trims and persists allergies for the authenticated profile', async () => {
    updateProfile.mockResolvedValue({
      toJSON: () => ({ id: 'user-1', name: 'User', allergies: 'Peanuts' }),
    });

    const result = await service.updateCurrentUserProfile('user-1', {
      allergies: '  Peanuts  ',
    });

    expect(updateProfile).toHaveBeenCalledWith('user-1', {
      allergies: 'Peanuts',
    });
    expect(result.allergies).toBe('Peanuts');
  });

  it('stores an empty allergies value as null', async () => {
    updateProfile.mockResolvedValue({
      toJSON: () => ({ id: 'user-1', name: 'User', allergies: null }),
    });

    const result = await service.updateCurrentUserProfile('user-1', {
      allergies: '   ',
    });

    expect(updateProfile).toHaveBeenCalledWith('user-1', {
      allergies: null,
    });
    expect(result.allergies).toBeNull();
  });
});
