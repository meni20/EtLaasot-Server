import { randomBytes } from 'crypto';
import UserService from './user.service';
import { verifyPassword } from '../auth/password.util';

describe('Existing trainee provisioning participates in approval (offline)', () => {
  const original = { ...process.env };
  beforeAll(() => {
    process.env.NATIONAL_ID_HASH_SECRET = 'fictional-phase4-secret';
    process.env.NATIONAL_ID_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  });
  afterAll(() => {
    process.env = original;
  });
  it('uses the caller transaction for account and role and keeps mandatory password change', async () => {
    const t = { fictionalTransaction: true },
      create = jest.fn(async (value: any, _transaction?: unknown) => value),
      assign = jest.fn(
        async (
          _id: string,
          _role: number,
          _name: string,
          _transaction?: unknown,
          _branch?: string,
        ) => {},
      ),
      db = { transaction: jest.fn() };
    const lookup = jest.fn(
      async (_hash: string, _transaction?: unknown) => null,
    );
    const service = new UserService(
      db as never,
      { findByNationalIdHash: lookup, create } as never,
      { asignRoleToUser: assign } as never,
    );
    const result = await service.createTraineeWithRole(
      {
        id: '123456782',
        name: 'Fictional test',
        phoneNumber: '0500000000',
        dateOfBirth: '2010-01-01',
        branchId: 'branch-a',
      },
      t as never,
    );
    expect(db.transaction).not.toHaveBeenCalled();
    expect(lookup.mock.calls[0][1]).toBe(t);
    expect(create.mock.calls[0][1]).toBe(t);
    expect(assign.mock.calls[0][3]).toBe(t);
    expect(result.temporaryPassword.length).toBe(18);
    expect(result.user.mustChangePassword).toBe(true);
    expect(
      await verifyPassword(result.user.passwordHash!, result.temporaryPassword),
    ).toBe(true);
    expect(result.user.passwordHash).not.toContain(result.temporaryPassword);
    expect(result.user.nationalIdEncrypted).not.toContain('123456782');
    expect(result.user.temporaryPasswordExpiresAt!.getTime()).toBeGreaterThan(
      Date.now(),
    );
  });
  it.each([true, false])(
    'volunteer creation preserves role, branch, password and transaction ownership (caller=%s)',
    async (caller) => {
      const t = { fictionalTransaction: true };
      const lookup = jest.fn(async () => null);
      const create = jest.fn(async (value: any, _t?: unknown) => value);
      const assign = jest.fn(async (..._args: unknown[]) => {});
      const db = { transaction: jest.fn(async (work: any) => work(t)) };
      const service = new UserService(
        db as never,
        { findByNationalIdHash: lookup, create } as never,
        { asignRoleToUser: assign } as never,
      );
      const result = await service.createUserWithRole(
        {
          id: '123456782',
          name: 'Fictional',
          phoneNumber: '0500000000',
          dateOfBirth: '2000-01-01',
          branchId: 'branch-a',
        },
        caller ? (t as never) : undefined,
      );
      expect(db.transaction).toHaveBeenCalledTimes(caller ? 0 : 1);
      expect(create.mock.calls[0][1]).toBe(t);
      expect(assign).toHaveBeenCalledWith(
        result.user.id,
        1,
        'Fictional',
        t,
        'branch-a',
      );
      expect(result.user.mustChangePassword).toBe(true);
      expect(result.temporaryPassword).toHaveLength(18);
      expect(
        await verifyPassword(
          result.user.passwordHash!,
          result.temporaryPassword,
        ),
      ).toBe(true);
      expect(result.user.temporaryPasswordExpiresAt!.getTime()).toBeGreaterThan(
        Date.now(),
      );
    },
  );
  it('propagates role and later approval failures to the caller transaction without an inner commit', async () => {
    const pending: any[] = [],
      committed: any[] = [];
    const t = { fictionalTransaction: true };
    const db = {
      transaction: jest.fn(async (work: any) => {
        try {
          const result = await work(t);
          committed.push(...pending);
          return result;
        } finally {
          pending.length = 0;
        }
      }),
    };
    const create = jest.fn(async (value: any) => {
      pending.push(value);
      return value;
    });
    const assign = jest.fn(async (): Promise<void> => {
      throw new Error('role failure');
    });
    const service = new UserService(
      db as never,
      { findByNationalIdHash: async () => null, create } as never,
      { asignRoleToUser: assign } as never,
    );
    const input = {
      id: '123456782',
      name: 'Fictional',
      phoneNumber: '0500000000',
      dateOfBirth: '2000-01-01',
      branchId: 'branch-a',
    };
    await expect(
      db.transaction(async () => service.createUserWithRole(input, t as never)),
    ).rejects.toThrow('role failure');
    expect(committed).toHaveLength(0);
    assign.mockImplementation(async () => {});
    await expect(
      db.transaction(async () => {
        await service.createUserWithRole(input, t as never);
        throw new Error('approval failure');
      }),
    ).rejects.toThrow('approval failure');
    expect(committed).toHaveLength(0);
    expect(db.transaction).toHaveBeenCalledTimes(2);
  });
});
