import { JwtStrategy } from './jwt.strategy';
import { UnauthorizedException } from '@nestjs/common';
describe('JWT reset revocation boundary', () => {
  const secret = process.env.JWT_SECRET;
  beforeAll(() => {
    process.env.JWT_SECRET = 'fictional-jwt-recovery-secret';
  });
  afterAll(() => {
    if (secret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = secret;
  });
  it('checks the uncached revision before consulting the cached account context', async () => {
    const order: string[] = [];
    const auth = {
      assertSessionCurrent: jest.fn(async () => {
        order.push('revision');
      }),
      getMe: jest.fn(async () => {
        order.push('context');
        return { userId: 'user' };
      }),
    };
    const strategy = new JwtStrategy(auth as never);
    expect(
      await strategy.validate({ sub: 'user', sessionVersion: 2 }),
    ).toMatchObject({ sub: 'user' });
    expect(order).toEqual(['revision', 'context']);
    expect(auth.assertSessionCurrent).toHaveBeenCalledWith(
      'user',
      2,
      undefined,
    );
  });
  it('rejects revoked sessions even if account context would still be cached', async () => {
    const auth = {
      assertSessionCurrent: jest.fn(async () => {
        throw new UnauthorizedException();
      }),
      getMe: jest.fn(),
    };
    const strategy = new JwtStrategy(auth as never);
    await expect(
      strategy.validate({ sub: 'user', sessionVersion: 0 }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(auth.getMe).not.toHaveBeenCalled();
  });
  it('leaves credential validation to the session service and rejects missing subjects', async () => {
    const auth = {
      assertSessionCurrent: jest.fn(async () => {}),
      getMe: jest.fn(async () => ({ userId: 'user' })),
    };
    const strategy = new JwtStrategy(auth as never);
    await strategy.validate({ sub: 'user' });
    expect(auth.assertSessionCurrent).toHaveBeenCalledWith(
      'user',
      undefined,
      undefined,
    );
    await expect(strategy.validate({})).rejects.toThrow('Invalid token');
  });
});
