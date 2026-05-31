import UserRepository from './user.repository';
import { IUser } from './interfaces/user.interface';
import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import UserRoleService from '../user-role/user-role.service';
import { AUTH_ROLES } from 'src/constants/auth.constants';
import { Sequelize } from 'sequelize-typescript';
import { CurrentUserProfileDto } from './dtos/current-user-profile.dto';

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
        userData.branchId ?? undefined,
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
        userData.branchId ?? undefined,
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

  public async getCurrentUserProfile(userId: string) {
    try {
      const user = await this.userRepository.findById(userId);

      if (!user) {
        throw new NotFoundException('User not found');
      }

      return this.toSafeProfileDto(user);
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw err;
      }

      throw new InternalServerErrorException(err);
    }
  }

  public async updateCurrentUserProfile(
    userId: string,
    data: {
      email?: string | null;
      phoneNumber?: string;
      address?: string | null;
    },
  ) {
    try {
      const updateData: {
        email?: string | null;
        phoneNumber?: string;
        address?: string | null;
      } = {};

      if (Object.prototype.hasOwnProperty.call(data, 'email')) {
        updateData.email =
          data.email === undefined || data.email === null
            ? null
            : data.email.trim() || null;
      }

      if (Object.prototype.hasOwnProperty.call(data, 'phoneNumber')) {
        updateData.phoneNumber = data.phoneNumber?.trim();
      }

      if (Object.prototype.hasOwnProperty.call(data, 'address')) {
        updateData.address =
          data.address === undefined || data.address === null
            ? null
            : data.address.trim() || null;
      }

      const user = await this.userRepository.updateProfile(userId, updateData);

      if (!user) {
        throw new NotFoundException('User not found');
      }

      return this.toSafeProfileDto(user);
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw err;
      }

      throw new InternalServerErrorException(err);
    }
  }

  private toSafeProfileDto(user: any): CurrentUserProfileDto {
    const plain = typeof user.toJSON === 'function' ? user.toJSON() : user;

    return {
      id: plain.id,
      name: plain.name,
      phoneNumber: plain.phoneNumber ?? null,
      email: plain.email ?? null,
      address: plain.address ?? null,
      age: plain.age ?? null,
      branchId: plain.branchId ?? null,
      createdAt: plain.createdAt,
      updatedAt: plain.updatedAt,
    };
  }
}
