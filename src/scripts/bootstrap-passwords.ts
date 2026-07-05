import { NestFactory } from '@nestjs/core';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { AppModule } from '../app.module';
import User from '../modules/user/entities/user.entity';
import { decryptNationalId } from '../modules/user/national-id-encryption.util';
import {
  generateTemporaryPassword,
  getTemporaryPasswordExpiry,
  hashPassword,
} from '../modules/auth/password.util';

type BootstrapRow = {
  user: User;
  identifier: string;
  temporaryPassword: string;
  passwordHash: string;
};

const EXPORT_DIR = 'private-exports';

const csvEscape = (value: string) => `"${value.replace(/"/g, '""')}"`;

const getExportPath = () => {
  const date = new Date().toISOString().slice(0, 10);
  return path.resolve(
    process.cwd(),
    EXPORT_DIR,
    `password-bootstrap-${date}.csv`,
  );
};

const buildRows = async (users: User[]) => {
  const usedTemporaryPasswords = new Set<string>();
  const rows: BootstrapRow[] = [];

  for (const user of users) {
    if (!user.nationalIdEncrypted) {
      throw new Error(`User ${user.id} is missing encrypted national ID`);
    }

    let temporaryPassword = generateTemporaryPassword();
    while (usedTemporaryPasswords.has(temporaryPassword)) {
      temporaryPassword = generateTemporaryPassword();
    }
    usedTemporaryPasswords.add(temporaryPassword);

    rows.push({
      user,
      identifier: decryptNationalId(user.nationalIdEncrypted),
      temporaryPassword,
      passwordHash: await hashPassword(temporaryPassword),
    });
  }

  return rows;
};

async function run() {
  const resetExisting = process.argv.includes('--reset-existing');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const sequelize = app.get(Sequelize);
    const scannedCount = await User.count();
    const users = await User.findAll({
      where: resetExisting ? {} : { passwordHash: { [Op.is]: null } },
      attributes: ['id', 'name', 'nationalIdEncrypted', 'passwordHash'],
      order: [['name', 'ASC']],
    });
    const rows = await buildRows(users);
    const temporaryPasswordExpiresAt = getTemporaryPasswordExpiry();

    await sequelize.transaction(async (transaction) => {
      for (const row of rows) {
        await row.user.update(
          {
            passwordHash: row.passwordHash,
            passwordChangedAt: null,
            mustChangePassword: true,
            failedLoginAttempts: 0,
            lockedUntil: null,
            temporaryPasswordExpiresAt,
          },
          { transaction },
        );
      }
    });

    const exportPath = getExportPath();
    await mkdir(path.dirname(exportPath), { recursive: true });
    await writeFile(
      exportPath,
      [
        'name,identifier,temporary_password',
        ...rows.map((row) =>
          [
            csvEscape(row.user.name ?? ''),
            csvEscape(row.identifier),
            csvEscape(row.temporaryPassword),
          ].join(','),
        ),
      ].join('\n'),
      'utf8',
    );

    console.log(`Users scanned: ${scannedCount}`);
    console.log(`Users updated: ${rows.length}`);
    console.log(`Export file: ${exportPath}`);
  } finally {
    await app.close();
  }
}

run().catch((error) => {
  console.error('Password bootstrap failed:', error.message);
  process.exit(1);
});
