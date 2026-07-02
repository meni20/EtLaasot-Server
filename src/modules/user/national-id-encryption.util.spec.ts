import {
  decryptNationalId,
  encryptNationalId,
} from './national-id-encryption.util';

const ORIGINAL_ENV = process.env.NATIONAL_ID_ENCRYPTION_KEY;
const TEST_KEY = Buffer.alloc(32, 7).toString('base64');

describe('national ID encryption utility', () => {
  beforeEach(() => {
    process.env.NATIONAL_ID_ENCRYPTION_KEY = TEST_KEY;
  });

  afterAll(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.NATIONAL_ID_ENCRYPTION_KEY;
      return;
    }

    process.env.NATIONAL_ID_ENCRYPTION_KEY = ORIGINAL_ENV;
  });

  it('encrypts and decrypts a national ID with AES-GCM versioned format', () => {
    const encrypted = encryptNationalId('123456782');

    expect(encrypted).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
    expect(encrypted).not.toContain('123456782');
    expect(decryptNationalId(encrypted)).toBe('123456782');
  });

  it('uses a random IV for each encryption', () => {
    const first = encryptNationalId('123456782');
    const second = encryptNationalId('123456782');

    expect(first).not.toBe(second);
    expect(decryptNationalId(first)).toBe('123456782');
    expect(decryptNationalId(second)).toBe('123456782');
  });

  it('fails clearly when the encryption key is invalid', () => {
    process.env.NATIONAL_ID_ENCRYPTION_KEY = 'not-a-32-byte-key';

    expect(() => encryptNationalId('123456782')).toThrow(
      'NATIONAL_ID_ENCRYPTION_KEY must be a 32-byte key encoded as base64 or 64-character hex',
    );
  });
});
