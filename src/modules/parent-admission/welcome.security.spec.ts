import { randomBytes, randomUUID } from 'crypto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  digest,
  openToken,
  sealToken,
  welcomeConfig,
} from './welcome.security';
import { PasswordSetupDto, WelcomeController } from './welcome.controller';
import { ApplicationApprovalDto } from './admission.dto';
import { EmailService } from '../email/email.service';
import { Logger } from '@nestjs/common';

describe('Welcome configuration, token encryption and public boundary (offline)', () => {
  const original = { ...process.env };
  const local = () => ({
    NODE_ENV: 'development',
    PUBLIC_CLIENT_ORIGIN: 'http://localhost:5173',
    REGISTRATION_WELCOME_EMAIL_KEY: randomBytes(32).toString('hex'),
    REGISTRATION_EMAIL_ALLOWED_RECIPIENTS: 'test@example.test',
  });
  afterEach(() => {
    process.env = { ...original };
  });
  it('rejects DEV/Production URL crossover, arbitrary origins, missing allowlists and unrelated runtime identities', () => {
    const env = local();
    expect(welcomeConfig(env).origin).toBe('http://localhost:5173');
    expect(() =>
      welcomeConfig({
        ...env,
        PUBLIC_CLIENT_ORIGIN: 'https://attacker.example',
      }),
    ).toThrow();
    expect(() =>
      welcomeConfig({
        ...env,
        PUBLIC_CLIENT_ORIGIN:
          'https://etlaasot-client-main-main.up.railway.app',
      }),
    ).toThrow();
    expect(() =>
      welcomeConfig({ ...env, REGISTRATION_EMAIL_ALLOWED_RECIPIENTS: '' }),
    ).toThrow();
    expect(() => welcomeConfig({ ...env, NODE_ENV: 'production' })).toThrow();
    const prod = {
      ...env,
      NODE_ENV: 'production',
      BRANCH_NAME: 'main',
      RAILWAY_PROJECT_ID: 'e950a261-d932-48c2-bc19-86287cb374ef',
      RAILWAY_ENVIRONMENT_ID: 'b5bc66a8-10fd-45ac-af6b-99a84c84a338',
      RAILWAY_ENVIRONMENT_NAME: 'main',
      RAILWAY_SERVICE_ID: '0172d945-f6bf-43ae-8ccb-dc4cf318604b',
    };
    expect(() => welcomeConfig(prod)).toThrow('WELCOME_ORIGIN_INVALID');
    expect(
      welcomeConfig({
        ...prod,
        PUBLIC_CLIENT_ORIGIN:
          'https://etlaasot-client-main-main.up.railway.app',
      }).production,
    ).toBe(true);
  });
  it('encrypts retry material with per-message authentication and never substitutes password/identity keys', () => {
    const env = local(),
      key = welcomeConfig(env).key,
      id = randomUUID(),
      token = randomBytes(32).toString('base64url');
    const sealed = sealToken(token, id, key);
    expect(sealed).not.toContain(token);
    expect(digest(token)).toHaveLength(64);
    expect(openToken(sealed, id, key)).toBe(token);
    expect(() => openToken(sealed, randomUUID(), key)).toThrow();
    expect(() => openToken(sealed, id, randomBytes(32))).toThrow();
    expect(() =>
      welcomeConfig({
        ...env,
        NATIONAL_ID_ENCRYPTION_KEY: env.REGISTRATION_WELCOME_EMAIL_KEY,
      }),
    ).toThrow();
  });
  it('requires a real boolean recipient confirmation and rejects extra approval privilege fields', () => {
    const valid = plainToInstance(ApplicationApprovalDto, {
      expectedVersionId: randomUUID(),
      identityVerified: true,
      welcomeEmailConfirmed: true,
    });
    expect(validateSync(valid)).toHaveLength(0);
    const invalid = plainToInstance(
      ApplicationApprovalDto,
      {
        expectedVersionId: randomUUID(),
        identityVerified: true,
        welcomeEmailConfirmed: 'false',
      },
      { enableImplicitConversion: true },
    );
    expect(validateSync(invalid).length).toBeGreaterThan(0);
    const setup = plainToInstance(PasswordSetupDto, {
      token: 'x'.repeat(43),
      password: 'Valid!Password',
      confirmation: 'Valid!Password',
      userId: randomUUID(),
    });
    expect(
      validateSync(setup, { whitelist: true, forbidNonWhitelisted: true })
        .length,
    ).toBeGreaterThan(0);
  });
  it('enforces Origin and shared abuse controls before password setup', async () => {
    process.env = { ...local(), REGISTRATION_WELCOME_EMAIL_ENABLED: 'true' };
    const consume = jest.fn(async () => ({ ok: true }));
    const limits = { consume: jest.fn(async () => undefined) };
    const controller = new WelcomeController(
      { enabled: () => true, consume } as never,
      limits as never,
    );
    const input = {
      token: 'x'.repeat(43),
      password: 'Valid!Password',
      confirmation: 'Valid!Password',
    };
    await expect(
      controller.setup(
        { get: () => 'https://attacker.example' } as never,
        input,
      ),
    ).rejects.toThrow('Origin');
    expect(consume).not.toHaveBeenCalled();
    limits.consume.mockRejectedValueOnce(Error('budget exceeded'));
    await expect(
      controller.setup(
        {
          get: () => 'http://localhost:5173',
          socket: { remoteAddress: '127.0.0.1' },
        } as never,
        input,
      ),
    ).rejects.toThrow('budget');
    expect(consume).not.toHaveBeenCalled();
  });
  it('does not expose SMTP diagnostics, setup URLs or credentials in error logging', async () => {
    const config: Record<string, string> = {
      SMTP_HOST: 'smtp.example.test',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'test',
      SMTP_APP_PASSWORD: 'fictional',
      EMAIL_FROM: 'sender@example.test',
    };
    const email = new EmailService({
      get: (key: string) => config[key],
    } as never);
    const logger = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    jest.spyOn(email as any, 'getTransporter').mockReturnValue({
      sendMail: async () => {
        throw Error('sensitive-setup-url-and-password');
      },
    });
    await expect(
      email.sendEmail({
        to: 'test@example.test',
        subject: 'test',
        text: 'test',
      }),
    ).rejects.toThrow('Failed to send email');
    expect(JSON.stringify(logger.mock.calls)).not.toContain('sensitive');
    logger.mockRestore();
  });
});
