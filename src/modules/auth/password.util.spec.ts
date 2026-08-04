import { BadRequestException } from '@nestjs/common';
import { getNationalIdDetails } from '../user/national-id.util';
import { validateNewPassword } from './password.util';

describe('validateNewPassword', () => {
  beforeAll(() => {
    process.env.NATIONAL_ID_HASH_SECRET = 'password-policy-test-secret';
  });

  it.each(['meni123', 'batyam22', 'shabat10'])(
    'accepts a reasonable simple password: %s',
    (password) => {
      expect(validateNewPassword(password)).toBe(password);
    },
  );

  it('trims leading and trailing spaces', () => {
    expect(validateNewPassword('  meni123  ')).toBe('meni123');
  });

  it.each(['123456', '111111', '000000', 'password', 'Password', 'qwerty'])(
    'rejects a common password: %s',
    (password) => {
      expect(() => validateNewPassword(password)).toThrow(BadRequestException);
    },
  );

  it('rejects fewer than six characters', () => {
    expect(() => validateNewPassword('abc12')).toThrow(BadRequestException);
  });

  it('rejects the user national ID', () => {
    const nationalId = '123456782';

    expect(() =>
      validateNewPassword(nationalId, {
        nationalIdHash: getNationalIdDetails(nationalId).nationalIdHash,
      }),
    ).toThrow('הסיסמה לא יכולה להיות זהה לתעודת הזהות');
  });

  it('rejects the user phone number regardless of formatting', () => {
    expect(() =>
      validateNewPassword('0501234567', { phoneNumber: '050-123-4567' }),
    ).toThrow('הסיסמה לא יכולה להיות זהה למספר הטלפון');
  });

  it('allows a password that merely contains the phone number', () => {
    expect(
      validateNewPassword('meni0501234567', {
        phoneNumber: '050-123-4567',
      }),
    ).toBe('meni0501234567');
  });

  it('allows a password that merely contains the national ID', () => {
    const nationalId = '123456782';

    expect(
      validateNewPassword(`meni${nationalId}`, {
        nationalIdHash: getNationalIdDetails(nationalId).nationalIdHash,
      }),
    ).toBe(`meni${nationalId}`);
  });
});
