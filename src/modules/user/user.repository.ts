import { Transaction } from 'sequelize';
import User from './entities/user.entity';
import { Injectable } from '@nestjs/common';
import { IUser } from './interfaces/user.interface';
import UserRole from '../user-role/enitites/user-role.entity';
import { AUTH_ROLES } from 'src/constants/auth.constants';

@Injectable()
export default class UserRepository {
  public async create(userData: IUser, transaction?: Transaction) {
    return await User.create(userData, { transaction });
  }

  public async getAllUsers() {
    return await User.findAll();
  }

  public async getAllVolunteers() {
    return await User.findAll({
      include: [
        {
          model: UserRole,
          where: { roleId: AUTH_ROLES.VOLUNTEER.id },
          attributes: [],
        },
      ],
    });
  }
  public async getAllTrainees() {
    return await User.findAll({
      include: [
        {
          model: UserRole,
          where: { roleId: AUTH_ROLES.TRAINEE.id },
          attributes: [],
        },
      ],
    });
  }
}
