import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { getRequiredEnv } from '../../config/env.util';

const NATIONAL_ID_ENCRYPTION_KEY_ENV = 'NATIONAL_ID_ENCRYPTION_KEY';
const NATIONAL_ID_ENCRYPTION_VERSION = 'v1';
const AES_256_KEY_LENGTH_BYTES = 32;
const AES_GCM_IV_LENGTH_BYTES = 12;
const AES_GCM_AUTH_TAG_LENGTH_BYTES = 16;

const decodeEncryptionKey = (rawKey: string) => {
  const trimmedKey = rawKey.trim();
  const hexKeyPattern = /^[0-9a-fA-F]{64}$/;
  const key = hexKeyPattern.test(trimmedKey)
    ? Buffer.from(trimmedKey, 'hex')
    : Buffer.from(trimmedKey, 'base64');

  if (key.length !== AES_256_KEY_LENGTH_BYTES) {
    throw new Error(
      `${NATIONAL_ID_ENCRYPTION_KEY_ENV} must be a 32-byte key encoded as base64 or 64-character hex`,
    );
  }

  return key;
};

const getNationalIdEncryptionKey = () =>
  decodeEncryptionKey(getRequiredEnv(NATIONAL_ID_ENCRYPTION_KEY_ENV));

export const assertNationalIdEncryptionKeyConfigured = () => {
  getNationalIdEncryptionKey();
};

export const encryptNationalId = (nationalId: string) => {
  const iv = randomBytes(AES_GCM_IV_LENGTH_BYTES);
  const cipher = createCipheriv(
    'aes-256-gcm',
    getNationalIdEncryptionKey(),
    iv,
  );
  const encrypted = Buffer.concat([
    cipher.update(nationalId, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    NATIONAL_ID_ENCRYPTION_VERSION,
    iv.toString('base64'),
    encrypted.toString('base64'),
    authTag.toString('base64'),
  ].join(':');
};

export const decryptNationalId = (encryptedNationalId: string) => {
  const [version, ivValue, encryptedValue, authTagValue, ...extraParts] =
    encryptedNationalId.split(':');

  if (
    version !== NATIONAL_ID_ENCRYPTION_VERSION ||
    !ivValue ||
    !encryptedValue ||
    !authTagValue ||
    extraParts.length
  ) {
    throw new Error('Invalid encrypted national ID format');
  }

  const iv = Buffer.from(ivValue, 'base64');
  const encrypted = Buffer.from(encryptedValue, 'base64');
  const authTag = Buffer.from(authTagValue, 'base64');

  if (iv.length !== AES_GCM_IV_LENGTH_BYTES) {
    throw new Error('Invalid encrypted national ID IV length');
  }

  if (authTag.length !== AES_GCM_AUTH_TAG_LENGTH_BYTES) {
    throw new Error('Invalid encrypted national ID auth tag length');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    getNationalIdEncryptionKey(),
    iv,
  );
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    'utf8',
  );
};
