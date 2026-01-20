import UserRepository from './user.repository';
import { IUser } from './interfaces/user.interface';
import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
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
      );
      return user;
    });
  }

  public getAllUsers() {
    try {
      return this.userRepository.getAllUsers();
    } catch (err) {
      throw new InternalServerErrorException(err);
    }
  }

  public getAllTrainees() {
    try {
      return this.userRepository.getAllTrainees();
    } catch (err) {
      throw new InternalServerErrorException(err);
    }
  }

  public getAllVolunteers() {
    try {
      return this.userRepository.getAllVolunteers();
    } catch (err) {
      throw new InternalServerErrorException(err);
    }
  }
}
