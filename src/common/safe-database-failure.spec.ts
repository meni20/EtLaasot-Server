import { Logger } from '@nestjs/common';
import { safeDatabaseFailure } from './safe-database-failure';
import UserService from '../modules/user/user.service';
import UserRoleService from '../modules/user-role/user-role.service';

describe('API database error boundary', () => {
  it('keeps only SQLSTATE in logs and returns a fixed HTTP 500 body', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    try {
      const error = {
        sql: 'private SQL',
        parameters: ['private value'],
        stack: 'private stack',
        original: { code: '23505' },
      };
      const expected = safeDatabaseFailure(error).getResponse();
      expect(expected).toEqual({
        statusCode: 500,
        message: 'אירעה שגיאה בשרת. נסו שוב מאוחר יותר.',
        error: 'Internal Server Error',
      });
      await expect(
        UserService.prototype.findById.call(
          {
            userRepository: {
              findById: async () => {
                throw error;
              },
            },
          },
          'fixture',
        ),
      ).rejects.toMatchObject({ response: expected });
      await expect(
        new UserRoleService({
          findRolesByUserId: async () => {
            throw error;
          },
        } as never).findRolesByUserId('fixture'),
      ).rejects.toMatchObject({ response: expected });
      expect(log.mock.calls).toEqual(
        Array.from({ length: 3 }, () => [
          'Database operation failed (SQLSTATE 23505)',
        ]),
      );
    } finally {
      log.mockRestore();
    }
  });
});
