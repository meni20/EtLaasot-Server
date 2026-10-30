import fs from 'fs';
import path from 'path';
import { Sequelize } from 'sequelize-typescript';
import {
  ADMISSION_MODELS,
  ApplicantSession,
  ApplicationVersion,
  TraineeApplication,
} from './admission.entities';
describe('Phase 4 migration/model packaging (no SQL)', () => {
  it('adds six isolated tables, indexes, server-only RLS, immutable evidence and no existing-data mutation', () => {
    const sql = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../migrations/031_parent_applications.sql',
      ),
      'utf8',
    );
    expect((sql.match(/CREATE TABLE public\./g) ?? []).length).toBe(6);
    expect(sql).toContain('national_id_hash varchar(64) NOT NULL UNIQUE');
    expect(sql).toContain(
      'approved_activity_year_id uuid REFERENCES public.activity_years',
    );
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain(
      "ARRAY['anon','authenticated','service_role','etlaasot_app']",
    );
    expect(sql).toContain('GRANT SELECT,INSERT ON TABLE');
    expect((sql.match(/CREATE TRIGGER/g) ?? []).length).toBe(3);
    expect(sql).not.toMatch(
      /ALTER TABLE public\."?user|UPDATE public\.|DELETE FROM|DROP TABLE|TRUNCATE|CREATE ROLE|SECURITY DEFINER|storage\.objects|GRANT[^;]*TO (?:anon|authenticated|service_role)/i,
    );
  });
  it('maps encrypted identity, hashed credentials and immutable timestamps without connecting', async () => {
    const db = new Sequelize({ dialect: 'postgres', logging: false });
    db.addModels(ADMISSION_MODELS);
    try {
      expect(TraineeApplication.getAttributes().nationalIdEncrypted.field).toBe(
        'national_id_encrypted',
      );
      expect(ApplicantSession.getAttributes().tokenHash.field).toBe(
        'token_hash',
      );
      expect(ApplicationVersion.getAttributes().updatedAt).toBeUndefined();
    } finally {
      await db.close();
    }
  });
});
