import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webPush from 'web-push';
import {
  RegisterPushSubscriptionDto,
  RemovePushSubscriptionDto,
} from './dtos/push-subscription.dto';
import {
  PushNotificationRepository,
  PushSubscriptionRecord,
} from './push-notification.repository';

const SELF_TEST_PAYLOAD = {
  title: 'עת לעשות',
  body: 'התראת בדיקה נשלחה בהצלחה',
  url: '/home',
  tag: 'etlaasot-self-test',
};

type VapidConfig = {
  subject: string;
  publicKey: string;
  privateKey: string;
};

@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);
  private vapidConfig?: VapidConfig;

  constructor(
    private readonly configService: ConfigService,
    private readonly repository: PushNotificationRepository,
  ) {}

  getPublicKey() {
    return { publicKey: this.getVapidConfig().publicKey };
  }

  async register(userUuid: string, dto: RegisterPushSubscriptionDto) {
    await this.repository.upsert(userUuid, dto);
    return { enabled: true };
  }

  async remove(userUuid: string, dto: RemovePushSubscriptionDto) {
    const removed = await this.repository.removeForUser(userUuid, dto.endpoint);
    return { enabled: false, removed };
  }

  async sendSelfTest(userUuid: string) {
    const subscriptions = await this.repository.findAllForUser(userUuid);

    if (subscriptions.length === 0) {
      this.throwNoActiveSubscription();
    }

    const vapid = this.getVapidConfig();
    const results = await Promise.all(
      subscriptions.map((subscription) =>
        this.sendToSubscription(userUuid, subscription, vapid),
      ),
    );
    const delivered = results.filter((result) => result === 'delivered').length;
    const temporaryFailures = results.filter(
      (result) => result === 'failed',
    ).length;

    if (delivered === 0 && temporaryFailures === 0) {
      this.throwNoActiveSubscription();
    }

    if (delivered === 0) {
      throw new ServiceUnavailableException({
        code: 'PUSH_DELIVERY_FAILED',
        message: 'לא הצלחנו לשלוח את התראת הבדיקה כרגע',
      });
    }

    return {
      message: 'התראת הבדיקה נשלחה בהצלחה',
      delivered,
    };
  }

  private async sendToSubscription(
    userUuid: string,
    subscription: PushSubscriptionRecord,
    vapid: VapidConfig,
  ): Promise<'delivered' | 'expired' | 'failed'> {
    try {
      await webPush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        },
        JSON.stringify(SELF_TEST_PAYLOAD),
        {
          TTL: 60,
          urgency: 'normal',
          topic: 'etlaasot-self-test',
          vapidDetails: {
            subject: vapid.subject,
            publicKey: vapid.publicKey,
            privateKey: vapid.privateKey,
          },
        },
      );
      return 'delivered';
    } catch (error) {
      const statusCode = this.getStatusCode(error);
      if (statusCode === 404 || statusCode === 410) {
        await this.repository.removeExpired(subscription.id, userUuid);
        this.logger.log(`Removed expired push subscription ${subscription.id}`);
        return 'expired';
      }

      this.logger.error(
        `Push delivery failed for subscription ${subscription.id}`,
        error instanceof Error ? error.stack : String(error),
      );
      return 'failed';
    }
  }

  private getVapidConfig(): VapidConfig {
    if (this.vapidConfig) return this.vapidConfig;

    const subject = this.configService
      .get<string>('WEB_PUSH_VAPID_SUBJECT')
      ?.trim();
    const publicKey = this.configService
      .get<string>('WEB_PUSH_VAPID_PUBLIC_KEY')
      ?.trim();
    const privateKey = this.configService
      .get<string>('WEB_PUSH_VAPID_PRIVATE_KEY')
      ?.trim();

    if (!subject || !publicKey || !privateKey) {
      this.logger.error('Web Push VAPID configuration is incomplete');
      throw new ServiceUnavailableException({
        code: 'PUSH_NOT_CONFIGURED',
        message: 'שירות ההתראות אינו מוגדר כרגע',
      });
    }

    try {
      webPush.setVapidDetails(subject, publicKey, privateKey);
    } catch (error) {
      this.logger.error(
        'Web Push VAPID configuration is invalid',
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableException({
        code: 'PUSH_NOT_CONFIGURED',
        message: 'שירות ההתראות אינו מוגדר כרגע',
      });
    }

    this.vapidConfig = { subject, publicKey, privateKey };
    return this.vapidConfig;
  }

  private getStatusCode(error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
    ) {
      return error.statusCode;
    }

    return undefined;
  }

  private throwNoActiveSubscription(): never {
    throw new NotFoundException({
      code: 'NO_ACTIVE_PUSH_SUBSCRIPTION',
      message: 'לא נמצאה הרשמה פעילה להתראות עבור המשתמש הנוכחי',
    });
  }
}
