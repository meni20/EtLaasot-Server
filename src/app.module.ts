import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';
import { UserModule } from './modules/user/user.module';
import { EventModule } from './modules/event/event.module';
import { AttendeeModule } from './modules/attendee/attendee.module';
import { UserRoleModule } from './modules/user-role/user-role.module';
import { AuthModule } from './modules/auth/auth.module';
import { BranchModule } from './modules/branch/branch.module';
import { MentorAssignmentModule } from './modules/mentor-assignment/mentor-assignment.module';
import { ActivityModule } from './modules/activity/activity.module';
import Role from './modules/roles/enitites/roles.entity';

const getRequiredEnv = (key: string): string => {
  const value = process.env[key]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
};

const getPortEnv = (key: string, fallback: number): number => {
  const rawValue = process.env[key]?.trim();

  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number(rawValue);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`Invalid port in environment variable ${key}: ${rawValue}`);
  }

  return parsedValue;
};

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    SequelizeModule.forRoot({
      dialect: 'postgres',
      host: getRequiredEnv('DB_HOST'),
      port: getPortEnv('DB_PORT', 5432),
      username: getRequiredEnv('DB_USER'),
      password: getRequiredEnv('DB_PASS'),
      database: getRequiredEnv('DB_NAME'),

      ssl: true,
      dialectOptions: {
        ssl: {
          require: true,
          rejectUnauthorized: false,
        },
      },

      autoLoadModels: true,
      sync: { alter: true },
    }),

    SequelizeModule.forFeature([Role]),

    UserModule,
    AuthModule,
    EventModule,
    UserRoleModule,
    AttendeeModule,
    BranchModule,
    MentorAssignmentModule,
    ActivityModule,
  ],
})
export class AppModule {}
