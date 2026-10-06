import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';
import PushSubscriptionEntity from './entities/push-subscription.entity';
import { PushNotificationController } from './push-notification.controller';
import { PushNotificationRepository } from './push-notification.repository';
import { PushNotificationService } from './push-notification.service';

@Module({
  imports: [ConfigModule, SequelizeModule.forFeature([PushSubscriptionEntity])],
  controllers: [PushNotificationController],
  providers: [PushNotificationService, PushNotificationRepository],
})
export class PushNotificationModule {}
