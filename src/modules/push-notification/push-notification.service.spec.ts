import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import webPush from 'web-push';
import { PushNotificationRepository } from './push-notification.repository';
import { PushNotificationService } from './push-notification.service';

describe('PushNotificationService', () => {
  const subscription = {
    id: 'subscription-1',
    userUuid: 'admin-1',
    endpoint: 'https://push.example/subscription-1',
    p256dh: 'p256dh-value',
    auth: 'auth-value',
    expirationTime: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSeenAt: new Date(),
  };

  const createService = () => {
    const values: Record<string, string> = {
      WEB_PUSH_VAPID_SUBJECT: 'mailto:notifications@example.com',
      WEB_PUSH_VAPID_PUBLIC_KEY: 'public-key',
      WEB_PUSH_VAPID_PRIVATE_KEY: 'private-key',
    };
    const configService = {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;
    const repository = {
      upsert: jest.fn(),
      removeForUser: jest.fn(),
      findAllForUser: jest.fn(),
      removeExpired: jest.fn(),
    } as unknown as jest.Mocked<PushNotificationRepository>;

    return {
      repository,
      service: new PushNotificationService(configService, repository),
    };
  };

  beforeEach(() => {
    jest.spyOn(webPush, 'setVapidDetails').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers a subscription under the authenticated JWT user', async () => {
    const { repository, service } = createService();
    repository.upsert.mockResolvedValue(subscription);
    const dto = {
      endpoint: subscription.endpoint,
      expirationTime: null,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    };

    await expect(service.register('admin-1', dto)).resolves.toEqual({
      enabled: true,
    });
    expect(repository.upsert).toHaveBeenCalledWith('admin-1', dto);
  });

  it('sends the fixed self-test only to the authenticated user subscriptions', async () => {
    const { repository, service } = createService();
    repository.findAllForUser.mockResolvedValue([subscription]);
    jest.spyOn(webPush, 'sendNotification').mockResolvedValue({} as never);

    await expect(service.sendSelfTest('admin-1')).resolves.toEqual({
      message: 'התראת הבדיקה נשלחה בהצלחה',
      delivered: 1,
    });

    expect(repository.findAllForUser).toHaveBeenCalledWith('admin-1');
    const [, payload] = (
      webPush.sendNotification as jest.MockedFunction<
        typeof webPush.sendNotification
      >
    ).mock.calls[0];
    expect(JSON.parse(payload as string)).toEqual({
      title: 'עת לעשות',
      body: 'התראת בדיקה נשלחה בהצלחה',
      url: '/home',
      tag: 'etlaasot-self-test',
    });
  });

  it('returns a clear response when the user has no subscription', async () => {
    const { repository, service } = createService();
    repository.findAllForUser.mockResolvedValue([]);

    await expect(service.sendSelfTest('admin-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repository.findAllForUser).toHaveBeenCalledWith('admin-1');
  });

  it('removes a subscription rejected as expired by the push provider', async () => {
    const { repository, service } = createService();
    repository.findAllForUser.mockResolvedValue([subscription]);
    repository.removeExpired.mockResolvedValue(undefined);
    jest
      .spyOn(webPush, 'sendNotification')
      .mockRejectedValue({ statusCode: 410 });

    await expect(service.sendSelfTest('admin-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repository.removeExpired).toHaveBeenCalledWith(
      'subscription-1',
      'admin-1',
    );
  });
});
