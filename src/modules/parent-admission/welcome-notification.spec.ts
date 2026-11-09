import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { WelcomeEmailService } from './welcome.service';
import { digest, openToken } from './welcome.security';

describe('Token-free approval notifications (offline; no SMTP or migrations)', () => {
  const saved = { ...process.env };
  let service: WelcomeEmailService, row: any, db: any, send: jest.Mock, t: any;
  const input = {
    applicationId: randomUUID(),
    userId: randomUUID(),
    passwordHash: '$argon2id$private-hash',
    email: 'family@example.test',
    authorized: true,
    notificationOnly: true,
  };
  beforeEach(() => {
    Object.assign(process.env, {
      NODE_ENV: 'development',
      REGISTRATION_WELCOME_EMAIL_ENABLED: 'true',
      REGISTRATION_WELCOME_EMAIL_KEY: 'c'.repeat(64),
      PUBLIC_CLIENT_ORIGIN: 'http://localhost:5173',
      REGISTRATION_EMAIL_ALLOWED_RECIPIENTS: 'family@example.test',
    });
    delete process.env.RAILWAY_ENVIRONMENT_ID;
    delete process.env.RAILWAY_PROJECT_ID;
    delete process.env.RAILWAY_SERVICE_ID;
    row = undefined;
    t = { afterCommit: jest.fn() };
    send = jest.fn(async () => ({ accepted: ['family@example.test'] }));
    db = {
      query: jest.fn(async (sql: string, options: any) => {
        const v = options?.replacements ?? {};
        if (sql.includes('information_schema.columns'))
          return [{ ready: true }];
        if (sql.includes('INSERT INTO')) {
          row ??= {
            id: v.id,
            application_id: v.application,
            user_id: v.user,
            recipient: v.recipient,
            status: v.status,
            reason: v.reason,
            delivery_kind: sql.includes("'APPROVAL_NOTICE'")
              ? 'APPROVAL_NOTICE'
              : 'PASSWORD_SETUP',
            token_hash: v.hash ?? null,
            token_ciphertext: v.cipher ?? null,
            credential_hash: v.credential ?? null,
            expires_at: v.expires ?? null,
            consumed_at: null,
            revoked_at: null,
            attempts: 0,
          };
          return [];
        }
        if (sql.startsWith('SELECT *')) return row ? [row] : [];
        if (sql.includes('WITH candidate')) {
          if (!row || row.status !== 'PENDING') return [];
          row.status = 'PROCESSING';
          row.claim_id = v.claim;
          row.attempts++;
          return [{ ...row }];
        }
        if (sql.includes("SET\n      status='PENDING'")) {
          row.status = 'PENDING';
          return [row];
        }
        if (sql.includes('status=:state')) {
          row.status = v.state;
          row.reason = v.reason;
          return [];
        }
        return [];
      }),
    };
    service = new WelcomeEmailService(db, { sendEmail: send } as never);
  });
  afterEach(() => {
    process.env = { ...saved };
    jest.restoreAllMocks();
  });
  it('queues a durable notice in the approval transaction without any token or credential fingerprint', async () => {
    const status = await service.enqueue(input, t);
    expect(status).toMatchObject({ status: 'PENDING', notificationOnly: true });
    expect(row.token_hash).toBeNull();
    expect(row.token_ciphertext).toBeNull();
    expect(row.credential_hash).toBeNull();
    expect(row.expires_at).toBeNull();
    expect(send).not.toHaveBeenCalled();
    expect(t.afterCommit).toHaveBeenCalledTimes(1);
    const insert = db.query.mock.calls.find(([sql]: [string]) =>
      sql.includes('INSERT INTO'),
    );
    expect(insert[1].transaction).toBe(t);
    expect(insert[1].logging).toBe(false);
    expect(JSON.stringify(insert)).not.toContain(input.passwordHash);
  });
  it('sends existing-password instructions with only a regular login link', async () => {
    await service.enqueue(input, t);
    await service.tick();
    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0][0];
    expect(message.text).toContain('בסיסמה שבחרתם בעת ההרשמה');
    expect(message.text).toContain('http://localhost:5173/login');
    expect(JSON.stringify(message)).not.toMatch(
      /setup-password|token=|argon2id|private-hash/,
    );
    expect(row.status).toBe('SENT');
    await service.tick();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('retains an email failure for retry without generating a setup link', async () => {
    await service.enqueue(input, t);
    send.mockRejectedValueOnce(Error('SMTP unavailable'));
    await service.tick();
    expect(row.status).toBe('PENDING');
    expect(row.token_hash).toBeNull();
    await service.tick();
    expect(row.status).toBe('SENT');
  });
  it('allows exhausted notice retry even though it has no expiration or token', async () => {
    await service.enqueue(input, t);
    row.status = 'FAILED';
    expect(await service.status(input.applicationId)).toMatchObject({
      notificationOnly: true,
      retryable: true,
    });
    const query = jest.spyOn(db, 'query');
    await service.retry(input.applicationId, 'manager-id', t);
    const retrySql = query.mock.calls.find(([sql]: [string]) =>
      sql.includes('retry_requested_by'),
    )?.[0];
    expect(retrySql).toContain("delivery_kind='APPROVAL_NOTICE' OR");
  });
  it('still blocks nonallowlisted DEV recipients and unconfirmed trainee recipients', async () => {
    await service.enqueue({ ...input, email: 'blocked@example.test' }, t);
    expect(row.status).toBe('SKIPPED');
    await service.tick();
    expect(send).not.toHaveBeenCalled();
    row = undefined;
    await service.enqueue({ ...input, authorized: false }, t);
    expect(row.reason).toBe('RECIPIENT_NOT_CONFIRMED');
  });
  it('preserves the legacy encrypted single-use password setup message', async () => {
    await service.enqueue({ ...input, notificationOnly: false }, t);
    expect(row.delivery_kind).toBe('PASSWORD_SETUP');
    const token = openToken(
      row.token_ciphertext,
      row.id,
      Buffer.from('c'.repeat(64), 'hex'),
    );
    expect(digest(token)).toBe(row.token_hash);
    expect(row.credential_hash).toBe(digest(input.passwordHash));
    await service.tick();
    expect(send.mock.calls[0][0].text).toContain('/setup-password#token=');
    expect(send.mock.calls[0][0].text).not.toContain(input.passwordHash);
  });
  it('returns DISABLED without querying schema or sending any email', async () => {
    process.env.REGISTRATION_WELCOME_EMAIL_ENABLED = 'false';
    expect(await service.enqueue(input, t)).toEqual({ status: 'DISABLED' });
    expect(db.query).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it('fails closed if the new notice schema is absent, without silently issuing a setup token', async () => {
    db.query.mockResolvedValueOnce([{ ready: false }]);
    await expect(service.enqueue(input, t)).rejects.toThrow('migration 040');
    expect(row).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
  it('prepared migration preserves legacy constraints, enforces token-free notices and changes no grants or existing rows', () => {
    const sql = readFileSync(
      'migrations/040_approval_notification_only.sql',
      'utf8',
    );
    expect(sql).toContain("NOT NULL DEFAULT 'PASSWORD_SETUP'");
    expect(sql).toContain('IF matches<>1 THEN RAISE EXCEPTION');
    expect(sql).toContain(
      'AND credential_hash IS NULL AND expires_at IS NULL AND consumed_at IS NULL',
    );
    expect(sql).toContain(
      "status<>'SKIPPED' AND token_hash IS NOT NULL AND credential_hash IS NOT NULL AND expires_at IS NOT NULL",
    );
    expect(sql).not.toMatch(
      /\b(?:DELETE FROM|TRUNCATE|DROP TABLE|UPDATE public|GRANT|DISABLE ROW LEVEL)\b/i,
    );
  });
});
