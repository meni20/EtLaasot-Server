import { Injectable } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import type { PwaPlatform } from './pwa-installation.constants';

export type PwaInstallationRecord = {
  id: string;
  installationId: string;
  userUuid: string;
  platform: PwaPlatform;
  installedAt: Date;
  lastSeenAt: Date;
};

@Injectable()
export class PwaInstallationRepository {
  constructor(private readonly sequelize: Sequelize) {}

  async register(
    userUuid: string,
    installationId: string,
    platform: PwaPlatform,
  ): Promise<PwaInstallationRecord> {
    const rows = await this.sequelize.query<PwaInstallationRecord>(
      `
        INSERT INTO pwa_installations (
          installation_id,
          user_uuid,
          platform,
          installed_at,
          last_seen_at
        )
        VALUES (
          :installationId,
          :userUuid,
          :platform,
          NOW(),
          NOW()
        )
        ON CONFLICT (installation_id)
        DO UPDATE SET last_seen_at = NOW()
        RETURNING
          id,
          installation_id AS "installationId",
          user_uuid AS "userUuid",
          platform,
          installed_at AS "installedAt",
          last_seen_at AS "lastSeenAt"
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { userUuid, installationId, platform },
      },
    );

    return rows[0];
  }
}
