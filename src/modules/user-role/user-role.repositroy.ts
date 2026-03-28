import { Injectable } from '@nestjs/common';
import UserRole from './enitites/user-role.entity';
import { Transaction } from 'sequelize';
import { BRANCHES } from 'src/constants/auth.constants';

@Injectable()
export default class UserRoleRepository {
  async assignRoleToUser(
    userId: string,
    roleId: number,
    grantedBy: string,
    transaction?: Transaction,
    branchId?: string,
  ) {
    return await UserRole.create(
      {
        userId,
        roleId,
        resourceId: branchId || BRANCHES.BAT_YAM.id,
        grantedBy,
        expirationDate: new Date(
          new Date().setFullYear(new Date().getFullYear() + 1),
        ),
      },
      { transaction },
    );
  }
  public async findRolesByUserId(userId: string) {
    return await UserRole.findAll({
      where: { userId },
    });
  }
}
