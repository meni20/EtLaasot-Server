import fs from 'fs';
import path from 'path';
const {
  assertTestTarget,
} = require('../../../scripts/parent-registration-test-safety.cjs');

describe('Isolated test safety and migration contract (no DB)', () => {
  const valid = {
    PHASE2_TEST_APPROVED: 'isolated-local-only',
    PHASE2_TEST_DATABASE_URL:
      'postgresql://etlaasot_test_runner:fictional-password@127.0.0.1:55439/etlaasot_parent_registration_test_local',
  };
  it('accepts only explicit approval and a dedicated local target', () => {
    expect(assertTestTarget(valid)).toMatchObject({
      host: '127.0.0.1',
      port: 55439,
      ssl: false,
    });
    expect(() => assertTestTarget({})).toThrow();
    expect(() =>
      assertTestTarget({ ...valid, PHASE2_TEST_APPROVED: '' }),
    ).toThrow();
  });
  it.each([
    'postgresql://postgres:x@db.example.invalid:5432/postgres',
    'postgresql://etlaasot_test_runner:x@127.0.0.1:5432/etlaasot_parent_registration_test_local',
    'postgresql://etlaasot_test_runner:x@127.0.0.1:55439/dev',
    'postgresql://etlaasot_test_runner:x@127.0.0.1:55439/etlaasot_parent_registration_test_local?host=remote',
    'postgresql://postgres:x@127.0.0.1:55439/etlaasot_parent_registration_test_local',
  ])('rejects unsafe test targets without connecting: %#', (url) =>
    expect(() =>
      assertTestTarget({ ...valid, PHASE2_TEST_DATABASE_URL: url }),
    ).toThrow(),
  );
  it('prepares a forward-only migration with RLS, constraints, and immutable evidence', () => {
    const sql = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../migrations/030_parent_registration.sql',
      ),
      'utf8',
    );
    expect(sql.match(/CREATE TABLE /g) ?? []).toHaveLength(6);
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('REVOKE ALL');
    expect(sql).toContain('registration_one_active_trainee');
    expect(sql).toContain('registration_one_yearly');
    expect(sql).toContain('registration_versions_immutable');
    expect(sql).toContain('registration_history_immutable');
    expect(sql).toContain('registration_documents_immutable');
    expect(sql).not.toMatch(
      /SECURITY DEFINER|DROP TABLE|TRUNCATE|storage\.objects|INSERT INTO "user"/i,
    );
  });
  it('supports the non-owner Supabase runtime role without exposing client roles', () => {
    const sql = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../migrations/030_parent_registration.sql',
      ),
      'utf8',
    );
    expect(sql).toContain('REVOKE ALL ON TABLE public.%I FROM etlaasot_app');
    expect(sql).toContain(
      'GRANT SELECT, INSERT ON TABLE public.%I TO etlaasot_app',
    );
    expect(sql).toContain(
      'FOR ALL TO etlaasot_app USING (true) WITH CHECK (true)',
    );
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.reject_registration_record_mutation() FROM %I',
    );
    expect(sql).not.toMatch(
      /CREATE POLICY[^;]*(?:TO anon|TO authenticated|TO service_role)/i,
    );
    expect(sql).not.toMatch(/ALTER ROLE|CREATE ROLE|FORCE ROW LEVEL SECURITY/i);
  });
});
