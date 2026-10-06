import { Sequelize } from 'sequelize-typescript';
import { PwaInstallationRepository } from './pwa-installation.repository';

describe('PwaInstallationRepository', () => {
  it('creates or touches an installation without changing its owner', async () => {
    const row = {
      id: 'row-1',
      installationId: '11111111-1111-4111-8111-111111111111',
      userUuid: 'user-1',
      platform: 'android',
      installedAt: new Date('2026-10-06T08:00:00.000Z'),
      lastSeenAt: new Date('2026-10-06T08:00:00.000Z'),
    };
    const query = jest.fn().mockResolvedValue([row]);
    const repository = new PwaInstallationRepository({
      query,
    } as unknown as Sequelize);

    await expect(
      repository.register(
        'user-1',
        '11111111-1111-4111-8111-111111111111',
        'android',
      ),
    ).resolves.toEqual(row);

    const [sql, options] = query.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (installation_id)');
    expect(sql).toContain('DO UPDATE SET last_seen_at = NOW()');
    expect(sql).not.toMatch(/DO UPDATE SET[\s\S]*user_uuid\s*=/);
    expect(options.replacements).toEqual({
      userUuid: 'user-1',
      installationId: '11111111-1111-4111-8111-111111111111',
      platform: 'android',
    });
  });
});
