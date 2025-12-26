import { Module } from '@nestjs/common';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { SequelizeModule } from '@nestjs/sequelize';
import VolunteerService from './modules/volunteer/volunteer.service';
import { VolunteerModule } from './modules/volunteer/volunteer.module';
import Volunteer from './modules/volunteer/entities/volunteer.entity';
import VolunteerController from './modules/volunteer/volunteer.controller';
import VolunteerRepository from './modules/volunteer/volunteer.repository';

@Module({
  imports: [
    ConfigModule.forRoot(),
    VolunteerModule,
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
    SequelizeModule.forFeature([Volunteer]),
  ],
  controllers: [AppController, VolunteerController],
  providers: [AppService, VolunteerRepository, VolunteerService],
})
export class AppModule {}
