import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';
import { UserModule } from './modules/user/user.module';
import { EventModule } from './modules/event/event.module';
import { AttendeeModule } from './modules/attendee/attendee.module';
import { UserRoleModule } from './modules/user-role/user-role.module';

@Module({
  imports: [
    ConfigModule.forRoot(),

    SequelizeModule.forRoot({
      dialect: 'postgres',
      host: process.env.DB_HOST,
      port: 5432,
      username: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,

      ssl: true,
      dialectOptions: {
        ssl: {
          require: true,
          rejectUnauthorized: false,
        },
      },

      autoLoadModels: true,
      synchronize: true,
    }),

    UserModule,
    EventModule,
    UserRoleModule,
    AttendeeModule,
  ],
})
export class AppModule {}
