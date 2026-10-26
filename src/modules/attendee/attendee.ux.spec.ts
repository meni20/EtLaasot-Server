import { ForbiddenException } from '@nestjs/common';
import { AuthorizationService } from '../auth/authorization.service';
import AttendeeController from './attendee.controller';
import Attendee from './entities/attendee.entity';

describe('Check-in authorization and retry response compatibility', () => {
  const service = { checkIn: jest.fn() };
  const controller = new AttendeeController(
    service as never,
    new AuthorizationService(),
  );
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(Attendee, 'findByPk')
      .mockResolvedValue({ event: { branchId: 'branch-a' } } as Attendee);
  });
  afterEach(() => jest.restoreAllMocks());
  it.each([
    [{ roleId: 1, branchId: 'branch-a' }],
    [{ roleId: 10000, branchId: 'branch-b' }],
  ])(
    'does not grant check-in writes to volunteers or another branch (%s)',
    async (role) => {
      await expect(
        controller.checkIn('attendee', {
          user: { userId: 'actor', roles: [role] },
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(service.checkIn).not.toHaveBeenCalled();
    },
  );
  it.each([[1], [0]])(
    'keeps the legacy affected-row response shape %s',
    async (count) => {
      service.checkIn.mockResolvedValue([count]);
      expect(
        await controller.checkIn('attendee', {
          user: {
            userId: 'admin',
            roles: [{ roleId: 10000, branchId: 'branch-a' }],
          },
        }),
      ).toEqual([count]);
      expect(service.checkIn).toHaveBeenCalledWith('attendee', 'admin');
    },
  );
});
