import fs from 'fs';
import path from 'path';

describe('039 application credentials migration contract (read only; no SQL execution)', () => {
  const sql = fs.readFileSync(
    path.resolve(
      __dirname,
      '../../../migrations/039_application_credentials.sql',
    ),
    'utf8',
  );
  it('adds one server-only table with identity and application uniqueness, without email uniqueness', () => {
    expect(sql.match(/CREATE TABLE /g)).toHaveLength(1);
    expect(sql).toContain('application_id uuid PRIMARY KEY');
    expect(sql).toContain('national_id_hash varchar(64) NOT NULL UNIQUE');
    expect(sql).toContain('FOREIGN KEY(application_id,national_id_hash)');
    expect(sql).toContain('ON DELETE RESTRICT');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain(
      'FROM PUBLIC,anon,authenticated,service_role,etlaasot_app',
    );
    expect(sql).toContain('FOR ALL TO etlaasot_app');
    expect(sql).not.toMatch(
      /UNIQUE\s*\(\s*login_email|login_email[^\n]*UNIQUE/i,
    );
  });
  it('retains unverified email and creates no email challenge or reset mechanism', () => {
    expect(sql).toContain('DEFAULT false CHECK (email_verified = false)');
    expect(sql).not.toMatch(/verification_token|email_challenge|reset_token/i);
    const service = fs.readFileSync(
      path.resolve(__dirname, 'application-credentials.service.ts'),
      'utf8',
    );
    expect(service).not.toMatch(
      /EmailService|WelcomeEmailService|sendEmail|applicantRecoveryCode|JwtService/,
    );
  });
  it('serializes both credential and user identity writers and requires a future approved hash transfer', () => {
    expect(sql.match(/pg_advisory_xact_lock/g)).toHaveLength(2);
    expect(sql).toContain(
      'BEFORE INSERT OR UPDATE OF national_id_hash ON public."user"',
    );
    expect(sql).toContain(
      'NEW.password_hash IS NOT DISTINCT FROM credential.password_hash',
    );
    expect(sql).toContain('NEW.must_change_password=false');
    expect(sql).toContain('NEW.temporary_password_expires_at IS NULL');
    expect(sql).not.toMatch(/SECURITY DEFINER/i);
  });
  it('preserves data and legacy recovery credentials while allowing password sessions and branchless drafts', () => {
    expect(sql).toContain("CHECK (status='DRAFT' OR branch_id IS NOT NULL)");
    expect(sql).toContain(
      'CHECK ((recovery_hash IS NULL) = (recovery_expires_at IS NULL))',
    );
    expect(sql).not.toMatch(
      /\b(?:DELETE FROM|TRUNCATE|DROP TABLE|UPDATE public\.)/i,
    );
    expect(sql).not.toMatch(
      /GRANT[^;]+TO (?:anon|authenticated|service_role)/i,
    );
  });
});
