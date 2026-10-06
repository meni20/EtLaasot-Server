import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('push subscription database access migration', () => {
  const readMigration = (filename: string) =>
    readFileSync(resolve(__dirname, '../../../migrations', filename), 'utf8');

  it('keeps browser roles blocked while allowing only the NestJS database role through RLS', () => {
    const tableMigration = readMigration(
      '027_create_push_subscriptions.sql',
    );
    const accessMigration = readMigration(
      '028_allow_server_push_subscription_access.sql',
    );

    expect(tableMigration).toMatch(
      /ENABLE\s+ROW\s+LEVEL\s+SECURITY/i,
    );
    expect(tableMigration).toMatch(
      /REVOKE\s+ALL\s+ON\s+TABLE\s+push_subscriptions\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i,
    );
    expect(accessMigration).toMatch(
      /GRANT\s+SELECT,\s*INSERT,\s*UPDATE,\s*DELETE\s+ON\s+TABLE\s+push_subscriptions\s+TO\s+etlaasot_app/i,
    );
    expect(accessMigration).toMatch(
      /CREATE\s+POLICY\s+push_subscriptions_server_access[\s\S]*FOR\s+ALL[\s\S]*TO\s+etlaasot_app[\s\S]*USING\s*\(true\)[\s\S]*WITH\s+CHECK\s*\(true\)/i,
    );
    expect(accessMigration).not.toMatch(/\bTO\s+(?:anon|authenticated)\b/i);
  });
});
