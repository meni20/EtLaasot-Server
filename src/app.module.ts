import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';
import * as fs from 'fs';
import * as path from 'path';
import { UserModule } from './modules/user/user.module';
import { EventModule } from './modules/event/event.module';
import { AttendeeModule } from './modules/attendee/attendee.module';
import { UserRoleModule } from './modules/user-role/user-role.module';
import { AuthModule } from './modules/auth/auth.module';
import { BranchModule } from './modules/branch/branch.module';
import { MentorAssignmentModule } from './modules/mentor-assignment/mentor-assignment.module';
import { ActivityModule } from './modules/activity/activity.module';
import { EmailModule } from './modules/email/email.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { TraineeMedicationModule } from './modules/trainee-medication/trainee-medication.module';
import Role from './modules/roles/enitites/roles.entity';
import { AuthorizationModule } from './modules/auth/authorization.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import {
  getBooleanEnv,
  getOptionalEnv,
  getPortEnv,
  getRequiredEnv,
} from './config/env.util';
import { loadRuntimeEnvironment } from '../scripts/runtime-environment.cjs';

const serverRoot = path.resolve(__dirname, '..');
export const runtimeEnvironment = loadRuntimeEnvironment({
  rootDir: serverRoot,
});
const serverEnvPath = runtimeEnvironment.envFilePath;

const getDbDialectOptions = () => {
  if (!getBooleanEnv('DB_SSL', true)) {
    return undefined;
  }

  const configuredCaPath = getOptionalEnv('DB_SSL_CA_PATH');
  const ca = configuredCaPath
    ? fs.readFileSync(
        path.isAbsolute(configuredCaPath)
          ? configuredCaPath
          : path.resolve(path.dirname(serverEnvPath), configuredCaPath),
        'utf8',
      )
    : undefined;

  return {
    keepAlive: true,
    application_name: 'etlaasot-server',
    ssl: {
      require: true,
      rejectUnauthorized: getBooleanEnv('DB_SSL_REJECT_UNAUTHORIZED', true),
      ...(ca ? { ca } : {}),
    },
  };
};

@Module({
  imports: [
    ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),

    SequelizeModule.forRoot({
      dialect: 'postgres',
      host: getRequiredEnv('DB_HOST'),
      port: getPortEnv('DB_PORT', 5432),
      username: getRequiredEnv('DB_USER'),
      password: getRequiredEnv('DB_PASS'),
      database: getRequiredEnv('DB_NAME'),

      ssl: getBooleanEnv('DB_SSL', true),
      dialectOptions: getDbDialectOptions(),

      // Keep a small, bounded pool warm. The production database is reached
      // through Supavisor, so repeatedly discarding the last connection makes
      // the next API request pay for a new TLS and pooler handshake.
      pool: {
        max: 5,
        min: 1,
        acquire: 10_000,
        idle: 60_000,
        evict: 60_000,
      },
      logging: getBooleanEnv('DB_LOGGING', false) ? console.log : false,

      autoLoadModels: true,
      synchronize: getBooleanEnv('DB_SYNC', false),
      sync: { alter: false },
    }),

    SequelizeModule.forFeature([Role]),

    AuthorizationModule,
    UserModule,
    AuthModule,
    EventModule,
    UserRoleModule,
    AttendeeModule,
    BranchModule,
    MentorAssignmentModule,
    ActivityModule,
    EmailModule,
    DashboardModule,
    TraineeMedicationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
