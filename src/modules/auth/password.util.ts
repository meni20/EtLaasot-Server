import { BadRequestException } from '@nestjs/common';
import { randomInt } from 'crypto';
import * as argon2 from 'argon2';
import { getNationalIdDetails } from '../user/national-id.util';

const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 128;
const TEMPORARY_PASSWORD_LENGTH = 18;
const LOWERCASE = 'abcdefghijkmnopqrstuvwxyz';
const UPPERCASE = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*()-_=+';
const PASSWORD_ALPHABET = `${LOWERCASE}${UPPERCASE}${DIGITS}${SYMBOLS}`;
const COMMON_PASSWORDS = new Set([
  '123456',
  '111111',
  '000000',
  'password',
  'qwerty',
]);

type PasswordIdentity = {
  nationalIdHash?: string | null;
  phoneNumber?: string | null;
};

const pick = (alphabet: string) => alphabet[randomInt(alphabet.length)];

const shuffle = (characters: string[]) => {
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [characters[index], characters[swapIndex]] = [
      characters[swapIndex],
      characters[index],
    ];
  }

  return characters.join('');
};

export const hashPassword = (password: string) =>
  argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

export const verifyPassword = async (
  passwordHash: string,
  password: string,
) => {
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
};

export const generateTemporaryPassword = () => {
  const characters = [
    pick(LOWERCASE),
    pick(UPPERCASE),
    pick(DIGITS),
    pick(SYMBOLS),
  ];

  while (characters.length < TEMPORARY_PASSWORD_LENGTH) {
    characters.push(pick(PASSWORD_ALPHABET));
  }

  return shuffle(characters);
};

export const validateNewPassword = (
  password: string,
  identity: PasswordIdentity = {},
) => {
  const normalizedPassword = String(password ?? '').trim();

  if (!normalizedPassword) {
    throw new BadRequestException('יש להזין סיסמה חדשה');
  }

  if (normalizedPassword.length < MIN_PASSWORD_LENGTH) {
    throw new BadRequestException(
      'הסיסמה צריכה להכיל לפחות 6 תווים ולא להיות סיסמה נפוצה מדי',
    );
  }

  if (normalizedPassword.length > MAX_PASSWORD_LENGTH) {
    throw new BadRequestException('הסיסמה ארוכה מדי');
  }

  if (COMMON_PASSWORDS.has(normalizedPassword.toLowerCase())) {
    throw new BadRequestException(
      'הסיסמה צריכה להכיל לפחות 6 תווים ולא להיות סיסמה נפוצה מדי',
    );
  }

  const passwordDigits = normalizedPassword.replace(/[\s()+-]/g, '');
  const phoneDigits = String(identity.phoneNumber ?? '').replace(/\D/g, '');

  if (/^\d+$/.test(passwordDigits) && phoneDigits === passwordDigits) {
    throw new BadRequestException('הסיסמה לא יכולה להיות זהה למספר הטלפון');
  }

  if (identity.nationalIdHash && /^\d{5,9}$/.test(normalizedPassword)) {
    let matchesNationalId = false;

    try {
      matchesNationalId =
        getNationalIdDetails(normalizedPassword).nationalIdHash ===
        identity.nationalIdHash;
    } catch {
      matchesNationalId = false;
    }

    if (matchesNationalId) {
      throw new BadRequestException(
        'הסיסמה לא יכולה להיות זהה לתעודת הזהות',
      );
    }
  }

  return normalizedPassword;
};

export const getTemporaryPasswordExpiry = () => {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 7);
  return expiry;
};
