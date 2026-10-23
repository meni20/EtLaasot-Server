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
    const lookup=jest.fn(async(_hash:string,_transaction?:unknown)=>null);
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
});
