import { PwaInstallationRepository } from './pwa-installation.repository';
import { PwaInstallationService } from './pwa-installation.service';

describe('PwaInstallationService', () => {
  it('uses the authenticated user id and client installation data', async () => {
    const register = jest.fn().mockResolvedValue({ id: 'row-1' });
    const service = new PwaInstallationService({
      register,
    } as unknown as PwaInstallationRepository);

    await expect(
      service.register('authenticated-user', {
        installationId: '11111111-1111-4111-8111-111111111111',
        platform: 'ios',
      }),
    ).resolves.toEqual({ registered: true });

    expect(register).toHaveBeenCalledWith(
      'authenticated-user',
      '11111111-1111-4111-8111-111111111111',
      'ios',
    );
  });

  it('allows one authenticated user to register two device installation ids', async () => {
    const register = jest.fn().mockResolvedValue({ id: 'row' });
    const service = new PwaInstallationService({
      register,
    } as unknown as PwaInstallationRepository);

    await service.register('authenticated-user', {
      installationId: '11111111-1111-4111-8111-111111111111',
      platform: 'android',
    });
    await service.register('authenticated-user', {
      installationId: '22222222-2222-4222-8222-222222222222',
      platform: 'ios',
    });

    expect(register).toHaveBeenNthCalledWith(
      1,
      'authenticated-user',
      '11111111-1111-4111-8111-111111111111',
      'android',
    );
    expect(register).toHaveBeenNthCalledWith(
      2,
      'authenticated-user',
      '22222222-2222-4222-8222-222222222222',
      'ios',
    );
  });
});
