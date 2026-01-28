import { Injectable, InternalServerErrorException } from '@nestjs/common';
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
  ) {
    try {
      return this.userRoleRepository.assignRoleToUser(
        userId,
        roleId,
        grantedBy,
        transaction,
      );
    } catch (err) {
      throw new InternalServerErrorException(err);
    }
  }
}
