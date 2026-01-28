import { Module } from '@nestjs/common';
import UserRoleService from './user-role.service';
import UserRoleRepository from './user-role.repositroy';
import { SequelizeModule } from '@nestjs/sequelize';
import UserRole from './enitites/user-role.entity';

@Module({
  imports: [SequelizeModule.forFeature([UserRole])],
  providers: [UserRoleService, UserRoleRepository],
  exports: [UserRoleService],
})
export class UserRoleModule {}
