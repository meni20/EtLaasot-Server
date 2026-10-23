import {
  AllowRegistrationAccess,
  onlyTrainee,
  RegistrationRequestAccess,
} from './registration-request-access';
import { RegistrationController } from './registration.controller';
import AuthController from '../auth/auth.controller';
import UserController from '../user/user.controller';

describe('Live renewal enforcement without cached JWT decisions (offline)', () => {
  const original = { ...process.env };
  const user = { userId: 'fictional-user', roles: [{ roleId: 2 }] };
  let db: any, access: RegistrationRequestAccess;
  function context(actor = user, handler = () => {}, klass = class {}) {
    return {
      getHandler: () => handler,
      getClass: () => klass,
      switchToHttp: () => ({ getRequest: () => ({ user: actor }) }),
    } as never;
  }
  beforeEach(() => {
    process.env.PARENT_REGISTRATION_ENABLED = 'true';
    process.env.PARENT_REGISTRATION_BLOCKING_ENABLED = 'true';
    delete process.env.PARENT_ADMISSION_SCHEMA_READY;
    db = { query: jest.fn(async () => [{ required: false }]) };
    access = new RegistrationRequestAccess(db);
  });
  afterAll(() => {
    process.env = original;
  });
  it('is disabled by default and makes no database query', async () => {
    delete process.env.PARENT_REGISTRATION_BLOCKING_ENABLED;
    await access.assertRequest(context());
    expect(db.query).not.toHaveBeenCalled();
  });
  it('checks every request so opening annual registration restricts already-authenticated sessions', async () => {
    await expect(access.assertRequest(context())).resolves.toBeUndefined();
    db.query.mockResolvedValue([{ required: true }]);
    await expect(access.assertRequest(context())).rejects.toMatchObject({
      response: { code: 'PARENT_REGISTRATION_REQUIRED' },
    });
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls[1][0]).toContain("p.status='OPEN'");
    expect(db.query.mock.calls[1][0]).toContain("f.status='APPROVED'");
  });
  it('includes blocking individual requests and permits nonblocking requests', async () => {
    await access.assertRequest(context());
    expect(db.query.mock.calls[0][0]).toContain('f.blocks_access');
    db.query.mockResolvedValue([{ required: true }]);
    await expect(access.assertRequest(context())).rejects.toThrow();
  });
  it.each([1, 10000, 10001])(
    'does not restrict volunteer/admin role %s even alongside trainee',
    async (roleId) => {
      expect(onlyTrainee({ roles: [{ roleId: 2 }, { roleId }] })).toBe(false);
      await access.assertRequest(
        context({ userId: 'fictional', roles: [{ roleId: 2 }, { roleId }] }),
      );
      expect(db.query).not.toHaveBeenCalled();
    },
  );
  it('permits only explicit essential endpoints, not a client URL or query bypass', async () => {
    const handler = () => {};
    AllowRegistrationAccess()({} as never, 'handler', {
      value: handler,
    } as never);
    await access.assertRequest(context(user, handler));
    expect(db.query).not.toHaveBeenCalled();
    expect(
      Reflect.getMetadata('registration:essential', RegistrationController),
    ).toBe(true);
    expect(
      Reflect.getMetadata(
        'registration:essential',
        AuthController.prototype.getMe,
      ),
    ).toBe(true);
    expect(
      Reflect.getMetadata(
        'registration:essential',
        UserController.prototype.getMe,
      ),
    ).toBe(true);
    expect(
      Reflect.getMetadata(
        'registration:essential',
        UserController.prototype.updateMe,
      ),
    ).toBeUndefined();
  });
  it('fails closed when the database cannot verify access', async () => {
    db.query.mockRejectedValue({ sql: 'private' });
    await expect(access.assertRequest(context())).rejects.toMatchObject({
      response: { code: 'REGISTRATION_STATUS_UNAVAILABLE' },
    });
  });
  it('does not query Phase 4 tables before the explicit schema-ready marker', async () => {
    await access.assertRequest(context());
    expect(db.query.mock.calls[0][0]).not.toContain('trainee_applications');
    process.env.PARENT_ADMISSION_SCHEMA_READY = 'true';
    await access.assertRequest(context());
    expect(db.query.mock.calls[1][0]).toContain(
      'approved_activity_year_id=y.id',
    );
  });
});
