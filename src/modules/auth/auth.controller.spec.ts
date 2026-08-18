import AuthController from './auth.controller';

describe('AuthController', () => {
  describe('login', () => {
    it('returns the access token for bearer authentication fallback', async () => {
      const authService = {
        login: jest.fn().mockResolvedValue({
          token: 'signed-token',
          roles: [{ role: 'TRAINEE', roleId: 2, branchId: 'branch-1' }],
          activeBranch: 'branch-1',
          mustChangePassword: false,
        }),
      };
      const response = { cookie: jest.fn() };
      const controller = new AuthController(authService as never);

      const result = await controller.login(
        { identifier: '123456782', password: 'Strong-password-1' },
        response as never,
      );

      expect(result.token).toBe('signed-token');
      expect(response.cookie).toHaveBeenCalledWith(
        'access_token',
        'signed-token',
        expect.objectContaining({ httpOnly: true, path: '/' }),
      );
    });
  });

  describe('getMe', () => {
    it('returns the user already resolved by the JWT strategy', () => {
      const authService = { getMe: jest.fn() };
      const controller = new AuthController(authService as never);
      const resolvedUser = {
        userId: 'user-1',
        sub: 'user-1',
        name: 'Resolved once',
        roles: [{ role: 'TRAINEE', roleId: 2, branchId: 'branch-1' }],
        activeBranch: 'branch-1',
        mustChangePassword: false,
      };

      expect(controller.getMe({ user: resolvedUser })).toEqual({
        userId: 'user-1',
        name: 'Resolved once',
        roles: [{ role: 'TRAINEE', roleId: 2, branchId: 'branch-1' }],
        activeBranch: 'branch-1',
        mustChangePassword: false,
      });
      expect(authService.getMe).not.toHaveBeenCalled();
    });
  });
});
