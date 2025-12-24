import { env } from 'process';
import { Module } from '@nestjs/common';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config'
import { AppController } from './app.controller';
import { SequelizeModule } from '@nestjs/sequelize';


@Module({
  imports: [
    ConfigModule.forRoot(),
    SequelizeModule.forRoot({
      dialect: 'postgres',
      host: "localhost",
      port: 5432,
      username: "postgres",
      password: "me6789",
      database: "Et-Laasot",
      autoLoadModels: true,
      synchronize: true,
      logging: console.log,
    }),
    SequelizeModule.forFeature(),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

