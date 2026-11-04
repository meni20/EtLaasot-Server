import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import { isEmail } from 'class-validator';
import {
  isVerifiedRailwayDevRuntime,
  isVerifiedRailwayProductionRuntime,
} from '../parent-registration/registration-environment';

export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export function welcomeConfig(env = process.env) {
  const production = isVerifiedRailwayProductionRuntime(env);
  const local =
    env.NODE_ENV === 'development' &&
    !env.RAILWAY_ENVIRONMENT_ID &&
    !env.RAILWAY_PROJECT_ID;
  if (!production && !isVerifiedRailwayDevRuntime(env) && !local)
    throw Error('WELCOME_RUNTIME_INVALID');
  const origin = env.PUBLIC_CLIENT_ORIGIN;
  const allowed = production
    ? ['https://etlaasot-client-main-main.up.railway.app']
    : [
        'https://etlaasot-client-dev-dev.up.railway.app',
        ...(local ? ['http://localhost:5173', 'http://localhost:5174'] : []),
      ];
  if (!origin || !allowed.includes(origin))
    throw Error('WELCOME_ORIGIN_INVALID');
  const key = env.REGISTRATION_WELCOME_EMAIL_KEY;
  if (
    !key ||
    !/^[a-f0-9]{64}$/i.test(key) ||
    [
      env.JWT_SECRET,
      env.NATIONAL_ID_ENCRYPTION_KEY,
      env.PARENT_REGISTRATION_TOKEN_PEPPER,
    ].includes(key)
  )
    throw Error('WELCOME_KEY_INVALID');
  const recipients = (env.REGISTRATION_EMAIL_ALLOWED_RECIPIENTS ?? '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  if (
    !production &&
    (!recipients.length || recipients.some((x) => !isEmail(x)))
  )
    throw Error('WELCOME_TEST_RECIPIENTS_REQUIRED');
  return { origin, key: Buffer.from(key, 'hex'), production, recipients };
}
export function sealToken(token: string, id: string, key: Buffer) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(id));
  const encrypted = Buffer.concat([
    cipher.update(token, 'utf8'),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((x) => x.toString('hex'))
    .join('.');
}
export function openToken(value: string, id: string, key: Buffer) {
  const [iv, tag, encrypted] = value
    .split('.')
    .map((x) => Buffer.from(x, 'hex'));
  const cipher = createDecipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(id));
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString(
    'utf8',
  );
}
