import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';
import { VolunteerModule } from './modules/volunteer/volunteer.module';
import Volunteer from './modules/volunteer/entities/volunteer.entity';
import VolunteerController from './modules/volunteer/volunteer.controller';
import VolunteerRepository from './modules/volunteer/volunteer.repository';
import VolunteerService from './modules/volunteer/volunteer.service';

@Module({
  imports: [
    ConfigModule.forRoot(),
    VolunteerModule,
    SequelizeModule.forRoot({
      dialect: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: 'me6789',
      database: 'Et-Laasot',
      autoLoadModels: true,
      synchronize: true,
      logging: console.log,
    }),
    SequelizeModule.forFeature([Volunteer])
  ],
  controllers: [AppController, VolunteerController],
  providers: [AppService, VolunteerRepository, VolunteerService],
})
export class AppModule {}
