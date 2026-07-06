import { BadRequestException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { getRequiredEnv } from 'src/config/env.util';

const NATIONAL_ID_HASH_SECRET_ENV = 'NATIONAL_ID_HASH_SECRET';
const NATIONAL_ID_LENGTH = 9;

export type NationalIdDetails = {
  normalizedNationalId: string;
  nationalIdHash: string;
  nationalIdLast4: string;
  nationalIdMasked: string;
};

export const assertNationalIdHashSecretConfigured = () => {
  getRequiredEnv(NATIONAL_ID_HASH_SECRET_ENV);
};

export const normalizeIsraeliNationalId = (value: string) => {
  const digits = String(value ?? '').replace(/\D/g, '');

  if (!/^\d{5,9}$/.test(digits)) {
    throw new BadRequestException('Invalid national ID');
  }

  return digits.padStart(NATIONAL_ID_LENGTH, '0');
};

export const isValidIsraeliNationalId = (value: string) => {
  let normalized: string;

  try {
    normalized = normalizeIsraeliNationalId(value);
  } catch {
    return false;
  }

  const sum = normalized
    .split('')
    .map((digit, index) => {
      const multiplied = Number(digit) * ((index % 2) + 1);
      return multiplied > 9 ? multiplied - 9 : multiplied;
    })
    .reduce((total, current) => total + current, 0);

  return sum % 10 === 0;
};

export const validateAndNormalizeIsraeliNationalId = (value: string) => {
  const normalized = normalizeIsraeliNationalId(value);

  if (!isValidIsraeliNationalId(normalized)) {
    throw new BadRequestException('Invalid national ID');
  }

  return normalized;
};

export const hashNationalId = (normalizedNationalId: string) =>
  createHmac('sha256', getRequiredEnv(NATIONAL_ID_HASH_SECRET_ENV))
    .update(normalizedNationalId)
    .digest('hex');

export const maskNationalIdLast4 = (last4?: string | null) =>
  last4 ? `*****${last4}` : null;

export const getNationalIdDetails = (value: string): NationalIdDetails => {
  const normalizedNationalId = validateAndNormalizeIsraeliNationalId(value);
  const nationalIdLast4 = normalizedNationalId.slice(-4);

  return {
    normalizedNationalId,
    nationalIdHash: hashNationalId(normalizedNationalId),
    nationalIdLast4,
    nationalIdMasked: maskNationalIdLast4(nationalIdLast4) ?? '',
  };
};
