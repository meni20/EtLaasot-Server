import { Module } from '@nestjs/common';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { SequelizeModule } from '@nestjs/sequelize';
import UserService from './modules/user/user.service';
import User from './modules/user/entities/user.entity';
import { UserModule } from './modules/user/user.module';
import UserController from './modules/user/user.controller';
import UserRepository from './modules/user/user.repository';

@Module({
  imports: [
    ConfigModule.forRoot(),
    UserModule,
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
    SequelizeModule.forFeature([User]),
  ],
  controllers: [AppController, UserController],
  providers: [AppService, UserRepository, UserService],
})
export class AppModule {}
