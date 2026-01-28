import { Module, forwardRef } from '@nestjs/common';
import UserService from './user.service';
import UserController from './user.controller';
import UserRepository from './user.repository';
import { SequelizeModule } from '@nestjs/sequelize';
import User from './entities/user.entity';
import { UserRoleModule } from '../user-role/user-role.module';

@Module({
  imports: [SequelizeModule.forFeature([User]), UserRoleModule],
  controllers: [UserController],
  providers: [UserService, UserRepository],
  exports: [UserService],
})
export class UserModule {}
