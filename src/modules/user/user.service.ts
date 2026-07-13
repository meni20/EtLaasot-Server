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
import { randomUUID } from 'crypto';
import { CurrentUserProfileDto } from './dtos/current-user-profile.dto';
import {
  generateTemporaryPassword,
  getTemporaryPasswordExpiry,
  hashPassword,
} from '../auth/password.util';
import {
  assertNationalIdHashSecretConfigured,
  getNationalIdDetails,
  maskNationalIdLast4,
} from './national-id.util';
import {
  assertNationalIdEncryptionKeyConfigured,
  decryptNationalId,
  encryptNationalId,
} from './national-id-encryption.util';

export type UserListStatus = 'active' | 'archived' | 'all';

@Injectable()
export default class UserService {
  constructor(
    private readonly sequelize: Sequelize,
    private readonly userRepository: UserRepository,
    private readonly userRoleService: UserRoleService,
  ) {
    assertNationalIdHashSecretConfigured();
    assertNationalIdEncryptionKeyConfigured();
  }

  async createUserWithRole(userData: IUser) {
    this.validateDateOfBirth(userData.dateOfBirth, true);
    const nationalIdDetails = getNationalIdDetails(userData.id);
    await this.assertNationalIdAvailable(nationalIdDetails.nationalIdHash);
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const temporaryPasswordExpiresAt = getTemporaryPasswordExpiry();

    try {
      const user = await this.sequelize.transaction(async (transaction) => {
        const user = await this.userRepository.create(
          this.normalizeCreateUserData(userData, nationalIdDetails, {
            passwordHash,
            temporaryPasswordExpiresAt,
          }),
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

      return {
        user,
        temporaryPassword,
        temporaryPasswordExpiresAt,
      };
    } catch (err) {
      this.throwConflictForDuplicateNationalId(err);
      throw err;
    }
  }

  async createTraineeWithRole(userData: IUser) {
    this.validateDateOfBirth(userData.dateOfBirth, true);
    const nationalIdDetails = getNationalIdDetails(userData.id);
    await this.assertNationalIdAvailable(nationalIdDetails.nationalIdHash);
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const temporaryPasswordExpiresAt = getTemporaryPasswordExpiry();

    try {
      const user = await this.sequelize.transaction(async (transaction) => {
        const user = await this.userRepository.create(
          this.normalizeCreateUserData(userData, nationalIdDetails, {
            passwordHash,
            temporaryPasswordExpiresAt,
          }),
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

      return {
        user,
        temporaryPassword,
        temporaryPasswordExpiresAt,
      };
    } catch (err) {
      this.throwConflictForDuplicateNationalId(err);
      throw err;
    }
  }

  private normalizeCreateUserData(
    userData: IUser,
    nationalIdDetails: ReturnType<typeof getNationalIdDetails>,
    authData?: {
      passwordHash?: string;
      temporaryPasswordExpiresAt?: Date;
    },
  ): IUser {
    return {
      ...userData,
      id: randomUUID(),
      nationalIdHash: nationalIdDetails.nationalIdHash,
      nationalIdLast4: nationalIdDetails.nationalIdLast4,
      nationalIdEncrypted: encryptNationalId(
        nationalIdDetails.normalizedNationalId,
      ),
      passwordHash: authData?.passwordHash ?? null,
      passwordChangedAt: null,
      mustChangePassword: Boolean(authData?.passwordHash),
      failedLoginAttempts: 0,
      lockedUntil: null,
      temporaryPasswordExpiresAt:
        authData?.temporaryPasswordExpiresAt ?? null,
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

  public getAllUsers(
    branchId?: string,
    includeNationalIdRevealId = false,
    status: UserListStatus = 'active',
  ) {
    try {
      return this.userRepository.getAllUsers(
        branchId,
        includeNationalIdRevealId,
        status,
      );
    } catch (err) {
      throw new InternalServerErrorException(err);
    }
  }

  public getAllTrainees(
    branchId?: string,
    includeNotes = false,
    includeNationalIdRevealId = false,
    status: UserListStatus = 'active',
  ) {
    try {
      return this.userRepository.getAllTrainees(
        branchId,
        includeNotes,
        includeNationalIdRevealId,
        status,
      );
    } catch (err) {
      throw new InternalServerErrorException(err);
    }
  }

  public getAllVolunteers(
    branchId?: string,
    includeNationalIdRevealId = false,
    status: UserListStatus = 'active',
  ) {
    try {
      return this.userRepository.getAllVolunteers(
        branchId,
        includeNationalIdRevealId,
        status,
      );
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

  public findByNationalIdHashForAuth(nationalIdHash: string) {
    try {
      return this.userRepository.findByNationalIdHashForAuth(nationalIdHash);
    } catch (err) {
      throw new InternalServerErrorException(err);
    }
  }

  public findByIdForAuth(userId: string) {
    try {
      return this.userRepository.findByIdForAuth(userId);
    } catch (err) {
      throw new InternalServerErrorException(err);
    }
  }

  public registerFailedLogin(
    userId: string,
    failedLoginAttempts: number,
    lockedUntil: Date | null,
  ) {
    return this.userRepository.registerFailedLogin(
      userId,
      failedLoginAttempts,
      lockedUntil,
    );
  }

  public clearLoginFailures(userId: string) {
    return this.userRepository.clearLoginFailures(userId);
  }

  public async updatePassword(
    userId: string,
    passwordHash: string,
    mustChangePassword: boolean,
    temporaryPasswordExpiresAt: Date | null,
    passwordChangedAt: Date | null = new Date(),
  ) {
    const updated = await this.userRepository.updatePasswordAuthState(userId, {
      passwordHash,
      passwordChangedAt,
      mustChangePassword,
      temporaryPasswordExpiresAt,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });

    if (!updated) {
      throw new NotFoundException('User not found');
    }
  }

  public async resetPassword(userId: string) {
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const temporaryPasswordExpiresAt = getTemporaryPasswordExpiry();

    await this.updatePassword(
      userId,
      passwordHash,
      true,
      temporaryPasswordExpiresAt,
      null,
    );

    return {
      temporaryPassword,
      temporaryPasswordExpiresAt,
    };
  }

  public async archiveUser(
    userId: string,
    archivedBy: string,
    reason?: string | null,
  ) {
    try {
      const existing = await this.userRepository.findById(userId, true);

      if (!existing) {
        throw new NotFoundException('User not found');
      }

      if (existing.isActive === false) {
        throw new ConflictException('User is already archived');
      }

      const archivedUser = await this.userRepository.archiveUser(userId, {
        archivedAt: new Date(),
        archivedBy,
        archiveReason: reason?.trim() || null,
      });

      if (!archivedUser) {
        throw new NotFoundException('User not found');
      }

      return {
        id: archivedUser.id,
        isActive: archivedUser.isActive,
        archivedAt: archivedUser.archivedAt,
        archivedBy: archivedUser.archivedBy,
        archiveReason: archivedUser.archiveReason,
      };
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        err instanceof ConflictException
      ) {
        throw err;
      }

      throw new InternalServerErrorException('Unable to archive user');
    }
  }

  public async restoreUser(userId: string) {
    try {
      const existing = await this.userRepository.findById(userId, true);

      if (!existing) {
        throw new NotFoundException('User not found');
      }

      if (existing.isActive !== false) {
        throw new ConflictException('User is already active');
      }

      const restoredUser = await this.userRepository.restoreUser(userId);

      if (!restoredUser) {
        throw new NotFoundException('User not found');
      }

      return {
        id: restoredUser.id,
        isActive: restoredUser.isActive,
        archivedAt: restoredUser.archivedAt,
        archivedBy: restoredUser.archivedBy,
        archiveReason: restoredUser.archiveReason,
      };
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        err instanceof ConflictException
      ) {
        throw err;
      }

      throw new InternalServerErrorException('Unable to restore user');
    }
  }

  public async getNationalIdByUuid(uuidId: string) {
    try {
      const user =
        await this.userRepository.findByIdForNationalIdReveal(uuidId);

      if (!user?.nationalIdEncrypted) {
        throw new NotFoundException('National ID not found');
      }

      return {
        nationalId: decryptNationalId(user.nationalIdEncrypted),
      };
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw err;
      }

      throw new InternalServerErrorException('Unable to reveal national ID');
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
    const existing =
      await this.userRepository.findByNationalIdHash(nationalIdHash);

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
