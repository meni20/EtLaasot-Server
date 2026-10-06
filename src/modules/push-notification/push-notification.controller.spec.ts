import { AUTH_ROLES } from 'src/constants/auth.constants';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { PushNotificationController } from './push-notification.controller';
import { PushNotificationService } from './push-notification.service';

describe('PushNotificationController', () => {
  it('takes the self-test recipient only from the authenticated request', async () => {
    const service = {
      sendSelfTest: jest.fn().mockResolvedValue({ delivered: 1 }),
    } as unknown as jest.Mocked<PushNotificationService>;
    const controller = new PushNotificationController(service);

    await expect(
      controller.sendSelfTest({ user: { userId: 'admin-1' } }),
    ).resolves.toEqual({ delivered: 1 });
    expect(service.sendSelfTest).toHaveBeenCalledWith('admin-1');
  });

  it('restricts the self-test route to both existing admin roles', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      PushNotificationController.prototype.sendSelfTest,
    );

    expect(roles).toEqual([
      AUTH_ROLES.SUPER_ADMIN.id,
      AUTH_ROLES.BRANCH_ADMIN.id,
    ]);
  });
});
