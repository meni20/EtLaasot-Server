import { col, FindAttributeOptions, Transaction } from 'sequelize';
import User from './entities/user.entity';
import { Injectable } from '@nestjs/common';
import { IUser, ShirtSize, UserGender } from './interfaces/user.interface';
import { AUTH_ROLES } from 'src/constants/auth.constants';
import UserRole from '../user-role/enitites/user-role.entity';
import Event from '../event/entities/event.entity';

@Injectable()
export default class UserRepository {
  private getSafeAttributes(
    includeNotes = true,
    includeNationalIdRevealId = false,
  ): FindAttributeOptions {
    const safeAttributes: FindAttributeOptions = {
      exclude: [
        'nationalIdHash',
        'nationalIdEncrypted',
        ...(includeNotes ? [] : ['notes', 'parentName']),
      ],
    };

    if (includeNationalIdRevealId && !Array.isArray(safeAttributes)) {
      safeAttributes.include = [
        [col('User.id'), 'nationalIdRevealId'] as unknown as string,
      ];
    }

    return safeAttributes;
  }

  public async create(userData: IUser, transaction?: Transaction) {
    return await User.create(userData, { transaction });
  }

  public async getAllUsers(
    branchId?: string,
    includeNationalIdRevealId = false,
  ) {
    const where: any = {};
    if (branchId) where.branchId = branchId;

    return await User.findAll({
      where,
      attributes: this.getSafeAttributes(true, includeNationalIdRevealId),
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

  public async getAllVolunteers(
    branchId?: string,
    includeNationalIdRevealId = false,
  ) {
    const where: any = {};
    if (branchId) where.branchId = branchId;

    return await User.findAll({
      where,
      attributes: this.getSafeAttributes(true, includeNationalIdRevealId),
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

  public async getAllTrainees(
    branchId?: string,
    includeNotes = false,
    includeNationalIdRevealId = false,
  ) {
    const where: any = {};
    if (branchId) where.branchId = branchId;

    return await User.findAll({
      where,
      attributes: this.getSafeAttributes(
        includeNotes,
        includeNationalIdRevealId,
      ),
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

  public async findByNationalIdHash(nationalIdHash: string) {
    return await User.findOne({
      where: { nationalIdHash },
    });
  }

  public async findByIdForNationalIdReveal(id: string) {
    return await User.findOne({
      where: { id },
      attributes: ['id', 'nationalIdEncrypted'],
    });
  }

  public async findById(id: string, includeNotes = false) {
    return await User.findByPk(id, {
      attributes: this.getSafeAttributes(includeNotes),
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
