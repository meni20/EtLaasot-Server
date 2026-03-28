import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import User from './modules/user/entities/user.entity';
import UserRole from './modules/user-role/enitites/user-role.entity';
import Role from './modules/roles/enitites/roles.entity';
import Branch from './modules/branch/entities/branch.entity';
import { AUTH_ROLES, BRANCHES } from './constants/auth.constants';

async function seed() {
  const app = await NestFactory.createApplicationContext(AppModule);

  console.log('🌱 Starting seed...');

  // 1. Seed roles
  for (const role of Object.values(AUTH_ROLES)) {
    await Role.findOrCreate({
      where: { id: role.id },
      defaults: { id: role.id, name: role.name } as any,
    });
    console.log(`  ✅ Role: ${role.name} (${role.id})`);
  }

  // 2. Seed branches
  for (const branch of Object.values(BRANCHES)) {
    await Branch.findOrCreate({
      where: { id: branch.id },
      defaults: {
        id: branch.id,
        name: branch.name,
        city: branch.city,
      } as any,
    });
    console.log(`  ✅ Branch: ${branch.name}`);
  }

  // 3. Create super admin user
  const ADMIN_ID = process.env.ADMIN_ID || '000000018';
  const ADMIN_NAME = process.env.ADMIN_NAME || 'מנהל על';

  const [adminUser] = await User.findOrCreate({
    where: { id: ADMIN_ID },
    defaults: {
      id: ADMIN_ID,
      name: ADMIN_NAME,
      phoneNumber: '0500000000',
      email: 'admin@etlaasot.org.il',
      address: '',
      age: 30,
    } as any,
  });
  console.log(`  ✅ Admin user: ${adminUser.name} (${adminUser.id})`);

  // 4. Assign SUPER_ADMIN role for all branches
  for (const branch of Object.values(BRANCHES)) {
    await UserRole.findOrCreate({
      where: {
        userId: ADMIN_ID,
        roleId: AUTH_ROLES.SUPER_ADMIN.id,
        resourceId: branch.id,
      },
      defaults: {
        userId: ADMIN_ID,
        roleId: AUTH_ROLES.SUPER_ADMIN.id,
        resourceId: branch.id,
        grantedBy: 'SYSTEM',
        expirationDate: new Date('2099-12-31'),
      } as any,
    });
    console.log(`  ✅ SUPER_ADMIN role for branch: ${branch.name}`);
  }

  console.log('\n🎉 Seed completed!');
  console.log(`\n📋 Login with ID: ${ADMIN_ID}`);

  await app.close();
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
