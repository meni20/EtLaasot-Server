import UserRepository from './user.repository';
import { IUser } from './interfaces/user.interface';
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import UserRoleService from '../user-role/user-role.service';
import { AUTH_ROLES } from 'src/constants/auth.constants';
import { Sequelize } from 'sequelize-typescript';

@Injectable()
export default class UserService {
  constructor(
    private readonly sequelize: Sequelize,
    private readonly userRepository: UserRepository,
    private readonly userRoleService: UserRoleService,
  ) {}

  async createUserWithRole(userData: IUser) {
    return await this.sequelize.transaction(async (transaction) => {
      const user = await this.userRepository.create(userData, transaction);

      await this.userRoleService.asignRoleToUser(
        user.id,
        AUTH_ROLES.VOLUNTEER.id,
        user.name,
        transaction,
        userData.branchId,
      );

      return user;
    });
  }

  async createTraineeWithRole(userData: IUser) {
    return await this.sequelize.transaction(async (transaction) => {
      const user = await this.userRepository.create(userData, transaction);
      await this.userRoleService.asignRoleToUser(
        user.id,
        AUTH_ROLES.TRAINEE.id,
        user.name,
        transaction,
        userData.branchId,
      );
      return user;
    });
  }

  public getAllUsers(branchId?: string) {
    try {
      return this.userRepository.getAllUsers(branchId);
    } catch (err) {
      throw new InternalServerErrorException(err);
    }
  }

  public getAllTrainees(branchId?: string) {
    try {
      return this.userRepository.getAllTrainees(branchId);
    } catch (err) {
      throw new InternalServerErrorException(err);
    }
  }

  public getAllVolunteers(branchId?: string) {
    try {
      return this.userRepository.getAllVolunteers(branchId);
    } catch (err) {
      throw new InternalServerErrorException(err);
    }
  }

  public countByBranchAndRole(branchId: string, roleId: number) {
    try {
      return this.userRepository.countByBranchAndRole(branchId, roleId);
    } catch (err) {
      throw new InternalServerErrorException(err);
    }
  }

  public findById(id: string) {
    try {
      return this.userRepository.findById(id);
    } catch (err) {
      throw new InternalServerErrorException(err);
    }
  }
}
