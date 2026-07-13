import { JwtService } from '@nestjs/jwt';
import UserService from '../user/user.service';
import BranchService from '../branch/branch.service';
import UserRoleService from '../user-role/user-role.service';
import { ROLE_ID_TO_NAME } from 'src/constants/auth.constants';
import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import axios from 'axios';
import { getIntegerEnv, getOptionalEnv } from 'src/config/env.util';
import {
  assertNationalIdHashSecretConfigured,
  getNationalIdDetails,
  maskNationalIdLast4,
} from '../user/national-id.util';
import {
  hashPassword,
  validateNewPassword,
  verifyPassword,
} from './password.util';

@Injectable()
export default class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly maxLoginAttempts = getIntegerEnv('AUTH_MAX_ATTEMPTS', 5);
  private readonly lockoutMs =
    getIntegerEnv('AUTH_LOCKOUT_SECONDS', 300) * 1000;

  constructor(
    private readonly userRoleService: UserRoleService,
    private readonly userService: UserService,
    private readonly branchService: BranchService,
    private jwt: JwtService,
  ) {
    assertNationalIdHashSecretConfigured();
  }

  async login(identifier: string, password: string, recaptchaToken?: string) {
    const nationalIdHash = this.getLoginNationalIdHash(identifier);
    const user =
      await this.userService.findByNationalIdHashForAuth(nationalIdHash);

    if (user) {
      await this.assertLoginAllowed(user);
    }

    await this.verifyRecaptchaIfConfigured(user, recaptchaToken);

    if (!user) {
      this.logger.warn('Login denied: invalid credentials');
      throw this.invalidCredentials();
    }

    const passwordMatches =
      !!user.passwordHash && (await verifyPassword(user.passwordHash, password));

    if (
      !passwordMatches ||
      this.isTemporaryPasswordExpired(user.mustChangePassword, user.temporaryPasswordExpiresAt)
    ) {
      await this.registerFailedLogin(user);
      this.logger.warn('Login denied: invalid credentials');
      throw this.invalidCredentials();
    }

    const userId = user.id;
    const rows = await this.userRoleService.findRolesByUserId(userId);

    if (!rows.length) {
      await this.registerFailedLogin(user);
      this.logger.warn('Login denied: invalid credentials');
      throw this.invalidCredentials();
    }

    const branches = (await this.branchService.getAllBranches()).filter(
      (branch): branch is NonNullable<typeof branch> => !!branch,
    );
    const branchMap = new Map(branches.map((branch) => [branch.id, branch]));

    const roles = rows.map((r) => ({
      role: ROLE_ID_TO_NAME[r.roleId] || 'UNKNOWN',
      roleId: r.roleId,
      branchId: r.resourceId as unknown as string,
      branchName: branchMap.get(r.resourceId as unknown as string)?.name || '',
    }));

    const activeBranch = roles[0]?.branchId || '';
    const mustChangePassword = Boolean(user.mustChangePassword);

    const payload = {
      sub: userId,
      roles,
      activeBranch,
      mustChangePassword,
    };

    const token = this.jwt.sign(payload);
    await this.userService.clearLoginFailures(userId);
    this.logger.log('Successful login');

    return {
      token,
      roles,
      activeBranch,
      mustChangePassword,
    };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    confirmPassword: string,
  ) {
    if (newPassword !== confirmPassword) {
      throw new BadRequestException('Password confirmation does not match');
    }

    if (currentPassword === newPassword) {
      throw new BadRequestException('New password must be different');
    }

    validateNewPassword(newPassword);

    const user = await this.userService.findByIdForAuth(userId);
    if (!user?.passwordHash) {
      throw this.invalidCredentials();
    }

    await this.assertLoginAllowed(user);

    if (
      this.isTemporaryPasswordExpired(
        user.mustChangePassword,
        user.temporaryPasswordExpiresAt,
      )
    ) {
      throw this.invalidCredentials();
    }

    const currentPasswordMatches = await verifyPassword(
      user.passwordHash,
      currentPassword,
    );

    if (!currentPasswordMatches) {
      await this.registerFailedLogin(user);
      throw this.invalidCredentials();
    }

    const passwordHash = await hashPassword(newPassword);
    await this.userService.updatePassword(userId, passwordHash, false, null);

    return { ok: true };
  }

  async getMe(userId: string) {
    const [rows, user, authState, branches] = await Promise.all([
      this.userRoleService.findRolesByUserId(userId),
      this.userService.findById(userId),
      this.userService.findByIdForAuth(userId),
      this.branchService.getAllBranches(),
    ]);
    const resolvedBranches = branches.filter(
      (branch): branch is NonNullable<typeof branch> => !!branch,
    );
    const branchMap = new Map(
      resolvedBranches.map((branch) => [branch.id, branch]),
    );

    const roles = rows.map((r) => ({
      role: ROLE_ID_TO_NAME[r.roleId] || 'UNKNOWN',
      roleId: r.roleId,
      branchId: r.resourceId as unknown as string,
      branchName: branchMap.get(r.resourceId as unknown as string)?.name || '',
    }));

    const activeBranch = roles[0]?.branchId || '';
    const safeUser =
      user && typeof user.toJSON === 'function' ? user.toJSON() : user;

    if (!authState?.isActive) {
      throw this.invalidCredentials();
    }

    return {
      userId: safeUser?.id ?? '',
      name: user?.name || '',
      nationalIdLast4: user?.nationalIdLast4 ?? null,
      nationalIdMasked: maskNationalIdLast4(user?.nationalIdLast4),
      roles,
      activeBranch,
      mustChangePassword: Boolean(authState?.mustChangePassword),
    };
  }

  private getLoginNationalIdHash(identifier: string) {
    try {
      return getNationalIdDetails(identifier).nationalIdHash;
    } catch {
      throw this.invalidCredentials();
    }
  }

  private async assertLoginAllowed(user: {
    id: string;
    isActive?: boolean | null;
    failedLoginAttempts?: number | null;
    lockedUntil?: Date | string | null;
  }) {
    if (user.isActive === false) {
      throw this.invalidCredentials();
    }

    const lockedUntil = user.lockedUntil
      ? new Date(user.lockedUntil).getTime()
      : 0;

    if (!lockedUntil) {
      return;
    }

    if (lockedUntil <= Date.now()) {
      await this.userService.clearLoginFailures(user.id);
      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
      return;
    }

    throw this.invalidCredentials();
  }

  private async registerFailedLogin(user: {
    id: string;
    failedLoginAttempts?: number | null;
    lockedUntil?: Date | string | null;
  }) {
    const failedLoginAttempts = Number(user.failedLoginAttempts ?? 0) + 1;
    const lockedUntil =
      failedLoginAttempts >= this.maxLoginAttempts
        ? new Date(Date.now() + this.lockoutMs)
        : null;

    user.failedLoginAttempts = failedLoginAttempts;
    user.lockedUntil = lockedUntil;
    await this.userService.registerFailedLogin(
      user.id,
      failedLoginAttempts,
      lockedUntil,
    );
  }

  private isTemporaryPasswordExpired(
    mustChangePassword?: boolean | null,
    temporaryPasswordExpiresAt?: Date | string | null,
  ) {
    return Boolean(
      mustChangePassword &&
        temporaryPasswordExpiresAt &&
        new Date(temporaryPasswordExpiresAt).getTime() <= Date.now(),
    );
  }

  private invalidCredentials() {
    return new UnauthorizedException('invalid credentials');
  }

  private async verifyRecaptchaIfConfigured(
    user: { id: string; failedLoginAttempts?: number | null } | null,
    recaptchaToken?: string,
  ) {
    const secret = getOptionalEnv('RECAPTCHA_SECRET_KEY');
    if (!secret) {
      return;
    }

    if (!recaptchaToken) {
      if (user) {
        await this.registerFailedLogin(user);
      }
      this.logger.warn('Login denied: invalid credentials');
      throw this.invalidCredentials();
    }

    const body = new URLSearchParams({
      secret,
      response: recaptchaToken,
    });

    const response = await axios
      .post('https://www.google.com/recaptcha/api/siteverify', body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 5000,
      })
      .catch(async () => {
        if (user) {
          await this.registerFailedLogin(user);
        }
        this.logger.warn('Login denied: invalid credentials');
        throw this.invalidCredentials();
      });

    if (!response.data?.success) {
      if (user) {
        await this.registerFailedLogin(user);
      }
      this.logger.warn('Login denied: invalid credentials');
      throw this.invalidCredentials();
    }
  }
}
