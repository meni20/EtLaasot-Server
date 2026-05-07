import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import VolunteerActivity from './entities/activity.entity';
import ActivityController from './activity.controller';
import ActivityService from './activity.service';
import ActivityRepository from './activity.repository';
import { UserModule } from '../user/user.module';
import { EventModule } from '../event/event.module';

@Module({
  imports: [
    SequelizeModule.forFeature([VolunteerActivity]),
    UserModule,
    EventModule,
  ],
  controllers: [ActivityController],
  providers: [ActivityService, ActivityRepository],
  exports: [ActivityService],
})
export class ActivityModule {}
