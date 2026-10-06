import { Injectable } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { RegisterPushSubscriptionDto } from './dtos/push-subscription.dto';

export type PushSubscriptionRecord = {
  id: string;
  userUuid: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date;
};

@Injectable()
export class PushNotificationRepository {
  constructor(private readonly sequelize: Sequelize) {}

  async upsert(
    userUuid: string,
    subscription: RegisterPushSubscriptionDto,
  ): Promise<PushSubscriptionRecord> {
    const expirationTime = subscription.expirationTime
      ? new Date(subscription.expirationTime)
      : null;
    const rows = await this.sequelize.query<PushSubscriptionRecord>(
      `
        INSERT INTO push_subscriptions (
          user_uuid,
          endpoint,
          p256dh,
          auth,
          expiration_time,
          created_at,
          updated_at,
          last_seen_at
        )
        VALUES (
          :userUuid,
          :endpoint,
          :p256dh,
          :auth,
          :expirationTime,
          NOW(),
          NOW(),
          NOW()
        )
        ON CONFLICT (endpoint)
        DO UPDATE SET
          user_uuid = EXCLUDED.user_uuid,
          p256dh = EXCLUDED.p256dh,
          auth = EXCLUDED.auth,
          expiration_time = EXCLUDED.expiration_time,
          updated_at = NOW(),
          last_seen_at = NOW()
        RETURNING
          id,
          user_uuid AS "userUuid",
          endpoint,
          p256dh,
          auth,
          expiration_time AS "expirationTime",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_seen_at AS "lastSeenAt"
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          userUuid,
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          expirationTime,
        },
      },
    );

    return rows[0];
  }

  async findAllForUser(userUuid: string): Promise<PushSubscriptionRecord[]> {
    return this.sequelize.query<PushSubscriptionRecord>(
      `
        SELECT
          id,
          user_uuid AS "userUuid",
          endpoint,
          p256dh,
          auth,
          expiration_time AS "expirationTime",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_seen_at AS "lastSeenAt"
        FROM push_subscriptions
        WHERE user_uuid = :userUuid
        ORDER BY created_at ASC
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { userUuid },
      },
    );
  }

  async removeForUser(userUuid: string, endpoint: string): Promise<boolean> {
    const rows = await this.sequelize.query<{ id: string }>(
      `
        DELETE FROM push_subscriptions
        WHERE user_uuid = :userUuid AND endpoint = :endpoint
        RETURNING id
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { userUuid, endpoint },
      },
    );

    return rows.length > 0;
  }

  async removeExpired(id: string, userUuid: string): Promise<void> {
    await this.sequelize.query(
      `
        DELETE FROM push_subscriptions
        WHERE id = :id AND user_uuid = :userUuid
      `,
      {
        replacements: { id, userUuid },
      },
    );
  }
}
