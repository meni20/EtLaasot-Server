import { randomBytes } from 'crypto';
import { DECLARATIONS, DECLARATION_VERSION } from './declarations';
import { fictionalRegistration } from './registration.test-fixtures';
import {
  contentHash,
  protectData,
  readData,
  validateDraft,
  validateSubmission,
} from './registration.validation';
import { RegistrationAccessPolicy } from './registration-access.policy';

describe('Parent registration data and signing policy (offline)', () => {
  let oldKey: string | undefined;
  beforeAll(() => {
    oldKey = process.env.NATIONAL_ID_ENCRYPTION_KEY;
    process.env.NATIONAL_ID_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  });
  afterAll(() => {
    if (oldKey === undefined) delete process.env.NATIONAL_ID_ENCRYPTION_KEY;
    else process.env.NATIONAL_ID_ENCRYPTION_KEY = oldKey;
  });
  it('accepts partial drafts without requiring complete stages', () => {
    expect(() => validateDraft({})).not.toThrow();
    expect(() =>
      validateDraft({
        parent1: { nationalId: '12345', name: '' },
        medical: { hasConditions: true },
      }),
    ).not.toThrow();
    expect(() => validateSubmission({})).toThrow();
  });
  it.each([false, true])(
    'validates a complete fictional form, twoParents=%s',
    (two) =>
      expect(() =>
        validateSubmission(fictionalRegistration(two)),
      ).not.toThrow(),
  );
  it.each([
    { traineeUuid: 'attacker' },
    { medical: { arbitrary: true } },
    { signatures: { strokes: [] } },
    { parent1: { nationalId: null } },
    { medical: { hasConditions: 'true' } },
    { trainee: { siblings: -1 } },
    { medical: { conditions: Array(31).fill('x') } },
    { parent1: { name: 'x'.repeat(301) } },
    JSON.parse('{"__proto__":{"polluted":true}}'),
  ])('rejects unknown keys, unsafe shapes or limits: %#', (data) =>
    expect(() => validateDraft(data)).toThrow(),
  );
  it('rejects oversized data without echoing its content', () => {
    const data = {
      medical: { conditions: Array(30).fill('sensitive'.repeat(300)) },
    };
    expect(() => validateDraft(data)).toThrow(
      expect.objectContaining({
        message: 'Invalid or incomplete registration field',
      }),
    );
  });
  it.each(['parent1', 'parent2'] as const)(
    'requires a national ID for signing %s',
    (parent) => {
      const data = fictionalRegistration();
      delete data[parent]!.nationalId;
      expect(() => validateSubmission(data)).toThrow();
    },
  );
  it('requires parent 1 handwriting and accepts unsigned optional parent 2 details', () => {
    const data = fictionalRegistration();
    delete data.signatures!.parent2;
    expect(() => validateSubmission(data)).not.toThrow();
    delete data.signatures!.parent1;
    expect(() => validateSubmission(data)).toThrow();
  });
  it.each([
    'hasConditions',
    'participationRestricted',
    'takesMedication',
    'hasFoodAllergies',
    'hasToiletingDifficulties',
  ] as const)('enforces conditional medical explanation for %s', (field) => {
    const data = fictionalRegistration();
    data.medical![field] = true;
    expect(() => validateSubmission(data)).toThrow();
  });
  it('requires ten acceptances and exact declaration version', () => {
    expect(DECLARATIONS).toHaveLength(10);
    const data = fictionalRegistration();
    data.declarationAcceptances![9] = false;
    expect(() => validateSubmission(data)).toThrow();
    data.declarationAcceptances![9] = true;
    data.declarationVersion = 'unapproved';
    expect(() => validateSubmission(data)).toThrow();
    expect(DECLARATION_VERSION).toMatch(/^parent-registration-v1-/);
  });
  it('hashes all content deterministically and excludes signature metadata', () => {
    const data = fictionalRegistration();
    const hash = contentHash(data);
    data.signatures!.parent1!.signedAt = '2020-01-01T00:00:00Z';
    expect(contentHash(data)).toBe(hash);
    data.medical!.allergies = 'new information';
    expect(contentHash(data)).not.toBe(hash);
    expect(() => validateSubmission(data)).toThrow();
  });
  it('encrypts all IDs at rest, without changing the signed data on read', () => {
    const data = fictionalRegistration();
    const stored = protectData(data);
    expect(JSON.stringify(stored)).not.toContain('123456782');
    expect(JSON.stringify(stored)).not.toContain('000000018');
    expect(stored.parent1!.nationalId).toMatch(/^v1:/);
    expect(readData(stored)).toEqual(data);
    expect(contentHash(readData(stored))).toBe(contentHash(data));
  });
  it('keeps blocking disabled by default and preserves essential flows when tested enabled', () => {
    const old = process.env.PARENT_REGISTRATION_BLOCKING_ENABLED;
    try {
      delete process.env.PARENT_REGISTRATION_BLOCKING_ENABLED;
      const policy = new RegistrationAccessPolicy();
      expect(() =>
        policy.assertAccess({
          trainee: true,
          required: true,
          essentialFlow: false,
        }),
      ).not.toThrow();
      process.env.PARENT_REGISTRATION_BLOCKING_ENABLED = 'true';
      expect(() =>
        policy.assertAccess({
          trainee: true,
          required: true,
          essentialFlow: false,
        }),
      ).toThrow();
      for (const flow of [
        'login',
        'logout',
        'password-reset',
        'password-change',
        'registration',
        'authorized-upload',
        'support',
      ]) {
        expect(() =>
          policy.assertAccess({
            trainee: true,
            required: true,
            essentialFlow: Boolean(flow),
          }),
        ).not.toThrow();
      }
      expect(() =>
        policy.assertAccess({
          trainee: false,
          required: true,
          essentialFlow: false,
        }),
      ).not.toThrow();
    } finally {
      if (old === undefined)
        delete process.env.PARENT_REGISTRATION_BLOCKING_ENABLED;
      else process.env.PARENT_REGISTRATION_BLOCKING_ENABLED = old;
    }
  });
});
