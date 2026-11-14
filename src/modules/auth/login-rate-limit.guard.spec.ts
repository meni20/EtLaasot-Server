import { LoginRateLimitGuard } from './login-rate-limit.guard';

describe('Main login rate limiter', () => {
  const env = process.env;
  beforeEach(() => {
    process.env = {
      ...env,
      JWT_SECRET: 'test-key',
      NATIONAL_ID_HASH_SECRET: 'test-id-key',
    };
  });
  afterEach(() => {
    process.env = env;
  });

  it('shares account budgets across peers and limits before invoking authentication', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ attempts: 1 }])
      .mockResolvedValueOnce([{ attempts: 1 }])
      .mockResolvedValueOnce([{ attempts: 13, retry: 41 }]);
    const setHeader = jest.fn();
    const req = {
      body: { identifier: '123456782' },
      socket: { remoteAddress: 'proxy-a' },
      headers: { 'x-forwarded-for': 'ignored' },
    };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({ setHeader }),
      }),
    };
    await expect(
      new LoginRateLimitGuard({ query } as never).canActivate(ctx as never),
    ).rejects.toMatchObject({ status: 429 });
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '41');
    const accountKey = query.mock.calls[2][1].bind.key;
    req.socket.remoteAddress = 'proxy-b';
    query.mockResolvedValue([{ attempts: 1 }]);
    await expect(
      new LoginRateLimitGuard({ query } as never).canActivate(ctx as never),
    ).resolves.toBe(true);
    expect(query.mock.calls[5][1].bind.key).toBe(accountKey);
    expect(query.mock.calls[4][1].bind.key).not.toBe(
      query.mock.calls[1][1].bind.key,
    );
    expect(accountKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it('fails closed on a database failure', async () => {
    const query = jest
      .fn()
      .mockRejectedValue(new Error('fixture database error'));
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ socket: {} }),
        getResponse: () => ({}),
      }),
    };
    await expect(
      new LoginRateLimitGuard({ query } as never).canActivate(ctx as never),
    ).rejects.toMatchObject({ status: 503 });
  });
});
