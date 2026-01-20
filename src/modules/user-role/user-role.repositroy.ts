import { Injectable } from '@nestjs/common';
import UserRole from './enitites/user-role.entity';
import { Transaction } from 'sequelize';

@Injectable()
export default class UserRoleRepository {
  async assignRoleToUser(
    userId: string,
    roleId: number,
    grantedBy: string,
    transaction?: Transaction,
  ) {
    return await UserRole.create(
      {
        userId,
        roleId,
        grantedBy,
        expirationDate: new Date(
          new Date().setFullYear(new Date().getFullYear() + 1),
        ),
      },
      { transaction },
    );
  }
}
