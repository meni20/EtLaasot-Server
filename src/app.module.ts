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
import { AuthorizationModule } from './modules/auth/authorization.module';
import {
  getBooleanEnv,
  getPortEnv,
  getRequiredEnv,
} from './config/env.util';

const getDbDialectOptions = () => {
  if (!getBooleanEnv('DB_SSL', true)) {
    return undefined;
  }

  return {
    ssl: {
      require: true,
      rejectUnauthorized: getBooleanEnv('DB_SSL_REJECT_UNAUTHORIZED', true),
    },
  };
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

      ssl: getBooleanEnv('DB_SSL', true),
      dialectOptions: getDbDialectOptions(),

      autoLoadModels: true,
      sync: getBooleanEnv('DB_SYNC', false) ? { alter: false } : undefined,
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
  ],
})
export class AppModule {}
