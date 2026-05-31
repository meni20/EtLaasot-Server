export const isProduction = () => process.env.NODE_ENV === 'production';

export const getRequiredEnv = (key: string): string => {
  const value = process.env[key]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
};

export const getOptionalEnv = (
  key: string,
  fallback?: string,
): string | undefined => {
  const value = process.env[key]?.trim();
  return value || fallback;
};

export const getPortEnv = (key: string, fallback: number): number => {
  return getIntegerEnv(key, fallback, 'port');
};

export const getIntegerEnv = (
  key: string,
  fallback: number,
  label = 'integer',
): number => {
  const rawValue = process.env[key]?.trim();

  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number(rawValue);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(
      `Invalid ${label} in environment variable ${key}: ${rawValue}`,
    );
  }

  return parsedValue;
};

export const getBooleanEnv = (key: string, fallback = false): boolean => {
  const rawValue = process.env[key]?.trim().toLowerCase();

  if (!rawValue) {
    return fallback;
  }

  if (['true', '1', 'yes'].includes(rawValue)) {
    return true;
  }

  if (['false', '0', 'no'].includes(rawValue)) {
    return false;
  }

  throw new Error(`Invalid boolean in environment variable ${key}: ${rawValue}`);
};
