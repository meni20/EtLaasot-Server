import fs from 'fs';
import path from 'path';
import { Model } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import {
  REGISTRATION_MODELS,
  RegistrationForm,
  RegistrationFormDocument,
  RegistrationFormVersion,
} from './entities/registration.entities';
import { registrationFeatureModules } from './parent-registration.module';

describe('Registration packaging and associations (no database connection)', () => {
  it('registers the existing association graph and maps fields to the migration', async () => {
    const existing: any[] = [];
    function visit(dir: string) {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, item.name);
        if (item.isDirectory()) visit(file);
        else if (item.name.endsWith('.entity.ts')) {
          for (const exported of Object.values(require(file)))
            if (
              typeof exported === 'function' &&
              exported.prototype instanceof Model
            )
              existing.push(exported);
        }
      }
    }
    visit(path.resolve(__dirname, '..'));
    const db = new Sequelize({
      dialect: 'postgres',
      logging: false,
      models: [...existing, ...REGISTRATION_MODELS],
    });
    try {
      expect(RegistrationForm.getAttributes().traineeUuid.field).toBe(
        'trainee_uuid',
      );
      expect(String(RegistrationForm.getAttributes().branchId.type)).toBe(
        'VARCHAR(50)',
      );
      expect(RegistrationFormVersion.getAttributes()).not.toHaveProperty(
        'updatedAt',
      );
      expect(RegistrationFormVersion.getAttributes()).not.toHaveProperty(
        'createdAt',
      );
      expect(RegistrationForm.associations.trainee).toBeDefined();
      expect(RegistrationForm.associations.previousApprovedForm).toBeDefined();
      expect(RegistrationFormDocument.associations.version).toBeDefined();
    } finally {
      await db.close();
    }
  });
  it('does not load feature models by default and refuses sync/logging when enabled', () => {
    const flags = ['PARENT_REGISTRATION_ENABLED', 'DB_SYNC', 'DB_LOGGING'];
    const old = flags.map((key) => process.env[key]);
    try {
      flags.forEach((key) => delete process.env[key]);
      expect(registrationFeatureModules()).toEqual([]);
      process.env.PARENT_REGISTRATION_ENABLED = 'true';
      expect(registrationFeatureModules()).toHaveLength(1);
      process.env.DB_SYNC = 'true';
      expect(() => registrationFeatureModules()).toThrow('DB_SYNC=false');
      process.env.DB_SYNC = 'false';
      process.env.DB_LOGGING = 'true';
      expect(() => registrationFeatureModules()).toThrow('DB_LOGGING=false');
    } finally {
      flags.forEach((key, i) => {
        if (old[i] === undefined) delete process.env[key];
        else process.env[key] = old[i];
      });
    }
  });
});
