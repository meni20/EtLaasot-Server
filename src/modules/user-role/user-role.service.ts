import { safeDatabaseFailure } from '../../common/safe-database-failure';
import { Injectable } from '@nestjs/common';
import UserRoleRepository from './user-role.repositroy';
import { Transaction } from 'sequelize';

@Injectable()
export default class UserRoleService {
  constructor(private readonly userRoleRepository: UserRoleRepository) {}

  public async asignRoleToUser(
    userId: string,
    roleId: number,
    grantedBy: string,
    transaction?: Transaction,
    branchId?: string,
  ) {
    try {
      return await this.userRoleRepository.assignRoleToUser(
        userId,
        roleId,
        grantedBy,
        transaction,
        branchId,
      );
    } catch (err) {
      throw safeDatabaseFailure(err);
    }
  }

  public async findRolesByUserId(userId: string) {
    try {
      return await this.userRoleRepository.findRolesByUserId(userId);
    } catch (err) {
      throw safeDatabaseFailure(err);
    }
  }
}
