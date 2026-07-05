import { BadRequestException } from '@nestjs/common';
import { randomInt } from 'crypto';
import * as argon2 from 'argon2';

const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 128;
const TEMPORARY_PASSWORD_LENGTH = 18;
const LOWERCASE = 'abcdefghijkmnopqrstuvwxyz';
const UPPERCASE = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*()-_=+';
const PASSWORD_ALPHABET = `${LOWERCASE}${UPPERCASE}${DIGITS}${SYMBOLS}`;
const WEAK_PASSWORD_PATTERNS = [
  /password/i,
  /qwerty/i,
  /letmein/i,
  /123456/,
  /111111/,
  /000000/,
];

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

export const validateNewPassword = (password: string) => {
  if (!password || !password.trim()) {
    throw new BadRequestException('Password is required');
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new BadRequestException(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new BadRequestException(
      `Password must be at most ${MAX_PASSWORD_LENGTH} characters`,
    );
  }

  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) {
    throw new BadRequestException(
      'Password must include uppercase and lowercase letters',
    );
  }

  if (!/\d/.test(password)) {
    throw new BadRequestException('Password must include a number');
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    throw new BadRequestException('Password must include a symbol');
  }

  if (WEAK_PASSWORD_PATTERNS.some((pattern) => pattern.test(password))) {
    throw new BadRequestException('Password is too weak');
  }
};

export const getTemporaryPasswordExpiry = () => {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 7);
  return expiry;
};
