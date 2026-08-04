import { col, FindAttributeOptions, Transaction } from 'sequelize';
import User from './entities/user.entity';
import { Injectable } from '@nestjs/common';
import { IUser, ShirtSize, UserGender } from './interfaces/user.interface';
import { AUTH_ROLES } from 'src/constants/auth.constants';
import UserRole from '../user-role/enitites/user-role.entity';
import Event from '../event/entities/event.entity';

@Injectable()
export default class UserRepository {
  private getActiveWhere(status: 'active' | 'archived' | 'all' = 'active') {
    if (status === 'archived') {
      return { isActive: false };
    }

    if (status === 'all') {
      return {};
    }

    return { isActive: true };
  }

  private getSafeAttributes(
    includeNotes = true,
    includeNationalIdRevealId = false,
  ): FindAttributeOptions {
    const safeAttributes: FindAttributeOptions = {
      exclude: [
        'nationalIdHash',
        'nationalIdEncrypted',
        'passwordHash',
        'passwordChangedAt',
        'mustChangePassword',
        'failedLoginAttempts',
        'lockedUntil',
        'temporaryPasswordExpiresAt',
        ...(includeNotes ? [] : ['notes', 'parentName', 'allergies']),
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
    status: 'active' | 'archived' | 'all' = 'active',
  ) {
    const where: any = this.getActiveWhere(status);
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
    status: 'active' | 'archived' | 'all' = 'active',
  ) {
    const where: any = this.getActiveWhere(status);
    if (branchId) where.branchId = branchId;

    return await User.findAll({
      where,
      attributes: this.getSafeAttributes(true, includeNationalIdRevealId),
      include: [
        {
          model: UserRole,
          where: { roleId: AUTH_ROLES.VOLUNTEER.id },
          attributes: ['roleId', 'resourceId'],
        },
      ],
      limit: 500,
    });
  }

  public async getAllTrainees(
    branchId?: string,
    includeNotes = false,
    includeNationalIdRevealId = false,
    status: 'active' | 'archived' | 'all' = 'active',
  ) {
    const where: any = this.getActiveWhere(status);
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
          attributes: ['roleId', 'resourceId'],
        },
      ],
      limit: 500,
    });
  }

  public async countByBranchAndRole(branchId: string, roleId: number) {
    return await User.count({
      where: { branchId, isActive: true },
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

  public async findByNationalIdHashForAuth(nationalIdHash: string) {
    return await User.findOne({
      where: { nationalIdHash, isActive: true },
      attributes: [
        'id',
        'name',
        'nationalIdHash',
        'passwordHash',
        'mustChangePassword',
        'failedLoginAttempts',
        'lockedUntil',
        'temporaryPasswordExpiresAt',
        'isActive',
        'branchId',
      ],
    });
  }

  public async findByIdForAuth(id: string) {
    return await User.findOne({
      where: { id, isActive: true },
      attributes: [
        'id',
        'name',
        'nationalIdHash',
        'phoneNumber',
        'passwordHash',
        'mustChangePassword',
        'failedLoginAttempts',
        'lockedUntil',
        'temporaryPasswordExpiresAt',
        'isActive',
        'branchId',
      ],
    });
  }

  public async findUsersWithoutPasswordHash() {
    return await User.findAll({
      where: { passwordHash: null },
      attributes: [
        'id',
        'name',
        'nationalIdEncrypted',
        'passwordHash',
        'mustChangePassword',
      ],
      order: [['name', 'ASC']],
    });
  }

  public async updatePasswordAuthState(
    id: string,
    data: {
      passwordHash: string;
      passwordChangedAt?: Date | null;
      mustChangePassword: boolean;
      temporaryPasswordExpiresAt?: Date | null;
      failedLoginAttempts?: number;
      lockedUntil?: Date | null;
    },
    transaction?: Transaction,
  ) {
    const [affectedCount] = await User.update(data, {
      where: { id },
      transaction,
    });

    return affectedCount > 0;
  }

  public async registerFailedLogin(
    id: string,
    failedLoginAttempts: number,
    lockedUntil: Date | null,
  ) {
    await User.update(
      { failedLoginAttempts, lockedUntil },
      { where: { id } },
    );
  }

  public async clearLoginFailures(id: string) {
    await User.update(
      { failedLoginAttempts: 0, lockedUntil: null },
      { where: { id } },
    );
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

  public async archiveUser(
    id: string,
    data: {
      archivedAt: Date;
      archivedBy: string;
      archiveReason: string | null;
    },
    transaction?: Transaction,
  ) {
    const user = await User.findByPk(id, { transaction });

    if (!user) {
      return null;
    }

    return await user.update(
      {
        isActive: false,
        archivedAt: data.archivedAt,
        archivedBy: data.archivedBy,
        archiveReason: data.archiveReason,
      },
      { transaction },
    );
  }

  public async restoreUser(id: string, transaction?: Transaction) {
    const user = await User.findByPk(id, { transaction });

    if (!user) {
      return null;
    }

    return await user.update(
      {
        isActive: true,
        archivedAt: null,
        archivedBy: null,
        archiveReason: null,
      },
      { transaction },
    );
  }

  public async updateProfile(
    id: string,
    data: {
      email?: string | null;
      phoneNumber?: string;
      address?: string | null;
      shirtSize?: ShirtSize | null;
      customShirtSize?: string | null;
      allergies?: string | null;
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
      allergies?: string | null;
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
