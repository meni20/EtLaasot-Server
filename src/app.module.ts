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
import { FeedbackModule } from './modules/feedback/feedback.module';
import { TraineeMedicationModule } from './modules/trainee-medication/trainee-medication.module';
import { TraineeDocumentModule } from './modules/trainee-document/trainee-document.module';
import { PwaInstallationModule } from './modules/pwa-installation/pwa-installation.module';
import { PushNotificationModule } from './modules/push-notification/push-notification.module';
import { registrationFeatureModules } from './modules/parent-registration/parent-registration.module';
import { admissionFeatureModules } from './modules/parent-admission/admission.module';
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
      hooks: {
        afterConnect: async (connection: unknown) => {
          if (!getBooleanEnv('PARENT_REGISTRATION_INTEGRATION_ENABLED', false))
            return;
          // Attest every new local integration pool connection before ORM or
          // authentication writes; deployed defaults do not enable this mode.
          const client = connection as {
            query(sql: string): Promise<{ rows: Array<{ ok: boolean }> }>;
            connection: { stream: { encrypted: boolean; authorized: boolean } };
          };
          if (
            process.env.SUPABASE_URL !==
              'https://vlysppqfozfiwcmsyban.supabase.co' ||
            process.env.DB_USER !== 'etlaasot_app.vlysppqfozfiwcmsyban' ||
            !client.connection.stream.encrypted ||
            !client.connection.stream.authorized
          ) {
            throw new Error(
              'Local integration database identity or TLS verification failed',
            );
          }
          await client.query('BEGIN READ ONLY');
          try {
            const result = await client.query(
              "SELECT current_database()='postgres' AND current_user='etlaasot_app' AND inet_server_addr()='2a05:d014:8ef:5902:b67d:7199:8fac:e6d0'::inet AND inet_server_port()=5432 AS ok",
            );
            if (result.rows[0]?.ok !== true)
              throw new Error(
                'Local integration database identity verification failed',
              );
            await client.query('COMMIT');
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          }
        },
      },
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
    FeedbackModule,
    TraineeMedicationModule,
    TraineeDocumentModule,
    PwaInstallationModule,
    PushNotificationModule,
    // No models/routes or schema sync for this feature until explicitly enabled.
    ...registrationFeatureModules(),
    ...admissionFeatureModules(),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
