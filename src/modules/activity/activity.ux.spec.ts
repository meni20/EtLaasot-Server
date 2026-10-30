import { HttpException } from '@nestjs/common';
import ActivityService from './activity.service';
import { AuthorizationService } from '../auth/authorization.service';

describe('Activity error response compatibility', () => {
  const actor = {
    userId: 'volunteer',
    roles: [{ roleId: 1, branchId: 'branch' }],
  };
  const repository = { findById: jest.fn(), findActiveByVolunteer: jest.fn() };
  const service = new ActivityService(
    repository as never,
    {} as never,
    {} as never,
    new AuthorizationService(),
  );
  it.each([
    [null, 404, 'Not Found', 'Activity not found', 'ACTIVITY_NOT_FOUND'],
    [
      { volunteerId: 'other' },
      403,
      'Forbidden',
      'You can only end your own activity',
      'ACTIVITY_NOT_OWNED',
    ],
    [
      { volunteerId: 'volunteer', status: 'ENDED' },
      409,
      'Conflict',
      'Only active activities can be ended',
      'ACTIVITY_NOT_ACTIVE',
    ],
    [
      { volunteerId: 'volunteer', status: 'ACTIVE' },
      400,
      'Bad Request',
      'Active activity is missing a valid start time',
      'ACTIVITY_INVALID_START',
    ],
    [
      {
        volunteerId: 'volunteer',
        status: 'ACTIVE',
        startTime: new Date('2999-01-01'),
      },
      400,
      'Bad Request',
      'End time must be after start time',
      'ACTIVITY_INVALID_END',
    ],
  ])(
    'preserves legacy status/message/error and adds code (%s)',
    async (record, statusCode, error, message, code) => {
      repository.findById.mockResolvedValue(record);
      try {
        await service.endActivity(actor, 'activity', {});
        throw Error('Expected rejection');
      } catch (caught) {
        expect(caught).toBeInstanceOf(HttpException);
        expect((caught as HttpException).getStatus()).toBe(statusCode);
        expect((caught as HttpException).getResponse()).toEqual({
          statusCode,
          error,
          message,
          code,
        });
      }
    },
  );
  it('keeps the existing start-activity conflict and adds a stable code', async () => {
    repository.findActiveByVolunteer.mockResolvedValue({ id: 'active' });
    try {
      await service.startActivity(actor, {
        eventId: 'event',
        traineeId: 'trainee',
      });
      throw Error('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(409);
      expect((error as HttpException).getResponse()).toEqual({
        statusCode: 409,
        message: 'Volunteer already has an active activity',
        error: 'Conflict',
        code: 'ACTIVITY_ALREADY_ACTIVE',
      });
    }
  });
});
