import { AuthGuard } from '@nestjs/passport';
import { JwtAuthGuard } from './jwt-auth.guard';
describe('JWT guard preserves password-change priority and fails closed (offline)', () => {
  const original = { ...process.env };
  const req = { user: { mustChangePassword: false } };
  const ctx = {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as never;
  let authenticate: jest.SpyInstance;
  beforeEach(() => {
    req.user.mustChangePassword = false;
    delete process.env.PARENT_REGISTRATION_BLOCKING_ENABLED;
    authenticate = jest
      .spyOn(AuthGuard('jwt').prototype, 'canActivate')
      .mockResolvedValue(true);
  });
  afterEach(() => {
    authenticate.mockRestore();
    process.env = { ...original };
  });
  it('preserves existing authentication when flags are off', async () => {
    await expect(new JwtAuthGuard().canActivate(ctx)).resolves.toBe(true);
    expect(authenticate).toHaveBeenCalled();
  });
  it('does not bypass enforcement if an enabled restriction provider is missing', async () => {
    process.env.PARENT_REGISTRATION_BLOCKING_ENABLED = 'true';
    await expect(new JwtAuthGuard().canActivate(ctx)).rejects.toThrow(
      'unavailable',
    );
  });
  it('requires mandatory password change before a normal protected operation', async () => {
    req.user.mustChangePassword = true;
    const assertRequest = jest.fn();
    await expect(
      new JwtAuthGuard({ assertRequest } as never).canActivate(ctx),
    ).rejects.toThrow('password change required');
    expect(assertRequest).not.toHaveBeenCalled();
  });
  it('runs registration checks after password/session authentication', async () => {
    const assertRequest = jest.fn(async () => {});
    await new JwtAuthGuard({ assertRequest } as never).canActivate(ctx);
    expect(assertRequest).toHaveBeenCalledWith(ctx);
  });
});
