import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('PWA installation database access migration', () => {
  const readMigration = (filename: string) =>
    readFileSync(resolve(__dirname, '../../../migrations', filename), 'utf8');

  it('keeps browser roles blocked while allowing only the NestJS database role through RLS', () => {
    const tableMigration = readMigration(
      '026_create_pwa_installations.sql',
    );
    const accessMigration = readMigration(
      '029_allow_server_pwa_installation_access.sql',
    );

    expect(tableMigration).toMatch(/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(tableMigration).toMatch(
      /REVOKE\s+ALL\s+ON\s+TABLE\s+pwa_installations\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i,
    );
    expect(accessMigration).toMatch(
      /GRANT\s+SELECT,\s*INSERT,\s*UPDATE,\s*DELETE\s+ON\s+TABLE\s+pwa_installations\s+TO\s+etlaasot_app/i,
    );
    expect(accessMigration).toMatch(
      /CREATE\s+POLICY\s+pwa_installations_server_access[\s\S]*FOR\s+ALL[\s\S]*TO\s+etlaasot_app[\s\S]*USING\s*\(true\)[\s\S]*WITH\s+CHECK\s*\(true\)/i,
    );
    expect(accessMigration).not.toMatch(/\bTO\s+(?:anon|authenticated)\b/i);
  });
});
