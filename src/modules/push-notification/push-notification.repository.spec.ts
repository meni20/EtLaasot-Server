import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { PushNotificationRepository } from './push-notification.repository';

describe('PushNotificationRepository', () => {
  it('upserts a browser subscription for the authenticated user', async () => {
    const row = {
      id: 'subscription-1',
      userUuid: 'user-1',
      endpoint: 'https://push.example/subscription-1',
      p256dh: 'p256dh-value',
      auth: 'auth-value',
      expirationTime: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSeenAt: new Date(),
    };
    const query = jest.fn().mockResolvedValue([row]);
    const repository = new PushNotificationRepository({
      query,
    } as unknown as Sequelize);

    await expect(
      repository.upsert('user-1', {
        endpoint: row.endpoint,
        expirationTime: null,
        keys: { p256dh: row.p256dh, auth: row.auth },
      }),
    ).resolves.toEqual(row);

    const [sql, options] = query.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (endpoint)');
    expect(sql).toContain('user_uuid = EXCLUDED.user_uuid');
    expect(options.type).toBe(QueryTypes.SELECT);
    expect(options.replacements).toMatchObject({
      userUuid: 'user-1',
      endpoint: row.endpoint,
      p256dh: row.p256dh,
      auth: row.auth,
    });
  });

  it('removes only the matching endpoint owned by the authenticated user', async () => {
    const query = jest.fn().mockResolvedValue([{ id: 'subscription-1' }]);
    const repository = new PushNotificationRepository({
      query,
    } as unknown as Sequelize);

    await expect(
      repository.removeForUser('user-1', 'https://push.example/subscription-1'),
    ).resolves.toBe(true);

    const [sql, options] = query.mock.calls[0];
    expect(sql).toContain(
      'WHERE user_uuid = :userUuid AND endpoint = :endpoint',
    );
    expect(sql).toContain('RETURNING id');
    expect(options.type).toBe(QueryTypes.SELECT);
    expect(options.replacements).toEqual({
      userUuid: 'user-1',
      endpoint: 'https://push.example/subscription-1',
    });
  });
});
