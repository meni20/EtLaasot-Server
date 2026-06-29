import UserRepository from './user.repository';
import { IUser, ShirtSize, UserGender } from './interfaces/user.interface';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import UserRoleService from '../user-role/user-role.service';
import { AUTH_ROLES } from 'src/constants/auth.constants';
import { Sequelize } from 'sequelize-typescript';
import { CurrentUserProfileDto } from './dtos/current-user-profile.dto';
import {
  assertNationalIdHashSecretConfigured,
  getNationalIdDetails,
  maskNationalIdLast4,
} from './national-id.util';

@Injectable()
export default class UserService {
  constructor(
    private readonly sequelize: Sequelize,
    private readonly userRepository: UserRepository,
    private readonly userRoleService: UserRoleService,
  ) {
    assertNationalIdHashSecretConfigured();
  }

  async createUserWithRole(userData: IUser) {
    this.validateDateOfBirth(userData.dateOfBirth, true);
    const nationalIdDetails = getNationalIdDetails(userData.id);
    await this.assertNationalIdAvailable(nationalIdDetails.nationalIdHash);

    try {
      return await this.sequelize.transaction(async (transaction) => {
        const user = await this.userRepository.create(
          this.normalizeCreateUserData(userData, nationalIdDetails),
          transaction,
        );

        await this.userRoleService.asignRoleToUser(
          user.id,
          AUTH_ROLES.VOLUNTEER.id,
          user.name,
          transaction,
          userData.branchId ?? undefined,
        );

        return user;
      });
    } catch (err) {
      this.throwConflictForDuplicateNationalId(err);
      throw err;
    }
  }

  async createTraineeWithRole(userData: IUser) {
    this.validateDateOfBirth(userData.dateOfBirth, true);
    const nationalIdDetails = getNationalIdDetails(userData.id);
    await this.assertNationalIdAvailable(nationalIdDetails.nationalIdHash);

    try {
      return await this.sequelize.transaction(async (transaction) => {
        const user = await this.userRepository.create(
          this.normalizeCreateUserData(userData, nationalIdDetails),
          transaction,
        );
        await this.userRoleService.asignRoleToUser(
          user.id,
          AUTH_ROLES.TRAINEE.id,
          user.name,
          transaction,
          userData.branchId ?? undefined,
        );
        return user;
      });
    } catch (err) {
      this.throwConflictForDuplicateNationalId(err);
      throw err;
    }
  }

  private normalizeCreateUserData(
    userData: IUser,
    nationalIdDetails: ReturnType<typeof getNationalIdDetails>,
  ): IUser {
    return {
      ...userData,
      id: nationalIdDetails.normalizedNationalId,
      nationalIdHash: nationalIdDetails.nationalIdHash,
      nationalIdLast4: nationalIdDetails.nationalIdLast4,
      email: userData.email?.trim() || null,
      dateOfBirth: userData.dateOfBirth ?? null,
      shirtSize: userData.shirtSize ?? null,
      customShirtSize:
        userData.shirtSize === 'OTHER'
          ? userData.customShirtSize?.trim() || null
          : null,
      notes: userData.notes?.trim() || null,
      parentName: userData.parentName?.trim() || null,
    };
  }

  public getAllUsers(branchId?: string) {
    try {
      return this.userRepository.getAllUsers(branchId);
    } catch (err) {
      throw new InternalServerErrorException(err);
    }
  }

  public getAllTrainees(branchId?: string, includeNotes = false) {
    try {
      return this.userRepository.getAllTrainees(branchId, includeNotes);
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

  public findById(id: string, includeNotes = false) {
    try {
      return this.userRepository.findById(id, includeNotes);
    } catch (err) {
      throw new InternalServerErrorException(err);
    }
  }

  public findByNationalIdHash(nationalIdHash: string) {
    try {
      return this.userRepository.findByNationalIdHash(nationalIdHash);
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

  public async updateUserDetails(
    userId: string,
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
    this.validateDateOfBirth(data.dateOfBirth);

    try {
      const updateData = {
        name: data.name.trim(),
        dateOfBirth: data.dateOfBirth ?? null,
        gender: data.gender ?? null,
        shirtSize: data.shirtSize ?? null,
        customShirtSize:
          data.shirtSize === 'OTHER'
            ? data.customShirtSize?.trim() || null
            : null,
        notes: data.notes?.trim() || null,
        ...(Object.prototype.hasOwnProperty.call(data, 'parentName')
          ? { parentName: data.parentName?.trim() || null }
          : {}),
        phoneNumber: data.phoneNumber.trim(),
        email:
          data.email === undefined || data.email === null
            ? null
            : data.email.trim() || null,
        address:
          data.address === undefined || data.address === null
            ? null
            : data.address.trim() || null,
      };

      const user = await this.userRepository.updateUserDetails(
        userId,
        updateData,
      );

      if (!user) {
        throw new NotFoundException('User not found');
      }

      return user;
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
      nationalIdLast4: plain.nationalIdLast4 ?? null,
      nationalIdMasked: maskNationalIdLast4(plain.nationalIdLast4),
      name: plain.name,
      phoneNumber: plain.phoneNumber ?? null,
      gender: plain.gender ?? null,
      email: plain.email ?? null,
      address: plain.address ?? null,
      age: plain.age ?? null,
      dateOfBirth: plain.dateOfBirth ?? null,
      shirtSize: plain.shirtSize ?? null,
      customShirtSize: plain.customShirtSize ?? null,
      branchId: plain.branchId ?? null,
      createdAt: plain.createdAt,
      updatedAt: plain.updatedAt,
    };
  }

  private async assertNationalIdAvailable(nationalIdHash: string) {
    const existing = await this.userRepository.findByNationalIdHash(
      nationalIdHash,
    );

    if (existing) {
      throw new ConflictException('User with this national ID already exists');
    }
  }

  private throwConflictForDuplicateNationalId(error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'name' in error &&
      error.name === 'SequelizeUniqueConstraintError'
    ) {
      throw new ConflictException('User with this national ID already exists');
    }
  }

  private validateDateOfBirth(
    dateOfBirth: string | null | undefined,
    required = false,
  ) {
    if (!dateOfBirth) {
      if (required) {
        throw new BadRequestException('dateOfBirth is required');
      }
      return;
    }

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth);
    if (!match) {
      throw new BadRequestException('dateOfBirth must be a valid date');
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const birthDate = new Date(Date.UTC(year, month - 1, day));

    if (
      birthDate.getUTCFullYear() !== year ||
      birthDate.getUTCMonth() !== month - 1 ||
      birthDate.getUTCDate() !== day
    ) {
      throw new BadRequestException('dateOfBirth must be a valid date');
    }

    const now = new Date();
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    if (birthDate > today) {
      throw new BadRequestException('dateOfBirth cannot be in the future');
    }

    let age = today.getUTCFullYear() - year;
    if (
      today.getUTCMonth() < month - 1 ||
      (today.getUTCMonth() === month - 1 && today.getUTCDate() < day)
    ) {
      age -= 1;
    }

    if (age > 120) {
      throw new BadRequestException('dateOfBirth must represent age 0-120');
    }
  }
}
