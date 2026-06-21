import { Transaction } from 'sequelize';
import User from './entities/user.entity';
import { Injectable } from '@nestjs/common';
import { IUser, ShirtSize, UserGender } from './interfaces/user.interface';
import { AUTH_ROLES } from 'src/constants/auth.constants';
import UserRole from '../user-role/enitites/user-role.entity';
import Event from '../event/entities/event.entity';

@Injectable()
export default class UserRepository {
  public async create(userData: IUser, transaction?: Transaction) {
    return await User.create(userData, { transaction });
  }

  public async getAllUsers(branchId?: string) {
    const where: any = {};
    if (branchId) where.branchId = branchId;

    return await User.findAll({
      where,
      include: [
        UserRole,
        {
          model: Event,
          through: { attributes: [] },
          required: false,
        },
      ],
      limit: 500,
    });
  }

  public async getAllVolunteers(branchId?: string) {
    const where: any = {};
    if (branchId) where.branchId = branchId;

    return await User.findAll({
      where,
      include: [
        {
          model: UserRole,
          where: { roleId: AUTH_ROLES.VOLUNTEER.id },
          attributes: [],
        },
      ],
      limit: 500,
    });
  }

  public async getAllTrainees(branchId?: string, includeNotes = false) {
    const where: any = {};
    if (branchId) where.branchId = branchId;

    return await User.findAll({
      where,
      attributes: includeNotes
        ? undefined
        : { exclude: ['notes', 'parentName'] },
      include: [
        {
          model: UserRole,
          where: { roleId: AUTH_ROLES.TRAINEE.id },
          attributes: [],
        },
      ],
      limit: 500,
    });
  }

  public async countByBranchAndRole(branchId: string, roleId: number) {
    return await User.count({
      where: { branchId },
      include: [
        {
          model: UserRole,
          where: { roleId },
          attributes: [],
        },
      ],
    });
  }

  public async findByIdentifyId(identifyId: string) {
    return await User.findOne({
      where: { id: identifyId },
    });
  }

  public async findById(id: string, includeNotes = false) {
    return await User.findByPk(id, {
      attributes: includeNotes
        ? undefined
        : { exclude: ['notes', 'parentName'] },
      include: [UserRole],
    });
  }

  public async updateProfile(
    id: string,
    data: {
      email?: string | null;
      phoneNumber?: string;
      address?: string | null;
    },
  ) {
    const user = await User.findByPk(id);

    if (!user) {
      return null;
    }

    return await user.update(data);
  }

  public async updateUserDetails(
    id: string,
    data: {
      name: string;
      dateOfBirth?: string | null;
      gender?: UserGender | null;
      shirtSize?: ShirtSize | null;
      customShirtSize?: string | null;
      notes?: string | null;
      parentName?: string | null;
      phoneNumber: string;
      email?: string | null;
      address?: string | null;
    },
  ) {
    const user = await User.findByPk(id);

    if (!user) {
      return null;
    }

    return await user.update(data);
  }
}
