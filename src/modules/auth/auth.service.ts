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
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { BRANCH_DISPLAY_BY_ID } from 'src/constants/auth.constants';

type AuthContextRoleRow = {
  roleId: number;
  resourceId?: string | null;
  branchName?: string | null;
};

type AuthContextRow = {
  userId: string;
  name: string;
  nationalIdLast4: string | null;
  mustChangePassword: boolean;
  fallbackBranchId: string | null;
  roles: AuthContextRoleRow[] | string;
};

export type AuthenticatedUser = {
  userId: string;
  name: string;
  nationalIdLast4: string | null;
  nationalIdMasked: string | null;
  roles: Array<{
    role: string;
    roleId: number;
    branchId: string;
    branchName: string;
  }>;
  activeBranch: string;
  mustChangePassword: boolean;
};

@Injectable()
export default class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly maxLoginAttempts = getIntegerEnv('AUTH_MAX_ATTEMPTS', 5);
  private readonly lockoutMs =
    getIntegerEnv('AUTH_LOCKOUT_SECONDS', 300) * 1000;
  private readonly authContextCacheMs = getIntegerEnv(
    'AUTH_CONTEXT_CACHE_MS',
    1000,
  );
  private readonly authContextCache = new Map<
    string,
    { expiresAt: number; value: AuthenticatedUser }
  >();
  private readonly authContextInFlight = new Map<
    string,
    Promise<AuthenticatedUser>
  >();

  constructor(
    private readonly sequelize: Sequelize,
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
      !!user.passwordHash &&
      (await verifyPassword(user.passwordHash, password));

    if (
      !passwordMatches ||
      this.isTemporaryPasswordExpired(
        user.mustChangePassword,
        user.temporaryPasswordExpiresAt,
      )
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

    const roles = this.buildRoles(
      rows,
      branchMap,
      user.branchId as string | null | undefined,
    );

    const activeBranch = roles.find((role) => role.branchId)?.branchId || '';
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
    const normalizedNewPassword = String(newPassword ?? '').trim();
    const normalizedConfirmation = String(confirmPassword ?? '').trim();

    if (normalizedNewPassword !== normalizedConfirmation) {
      throw new BadRequestException('אימות הסיסמה אינו תואם');
    }

    if (currentPassword === normalizedNewPassword) {
      throw new BadRequestException('הסיסמה החדשה צריכה להיות שונה');
    }

    const user = await this.userService.findByIdForAuth(userId);
    if (!user?.passwordHash) {
      throw this.invalidCredentials();
    }

    await this.assertLoginAllowed(user);

    validateNewPassword(normalizedNewPassword, {
      nationalIdHash: user.nationalIdHash,
      phoneNumber: user.phoneNumber,
    });

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

    const passwordHash = await hashPassword(normalizedNewPassword);
    await this.userService.updatePassword(userId, passwordHash, false, null);
    this.authContextCache.delete(userId);

    return { ok: true };
  }

  async getMe(userId: string): Promise<AuthenticatedUser> {
    const cached = this.authContextCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const existingRequest = this.authContextInFlight.get(userId);
    if (existingRequest) {
      return existingRequest;
    }

    const request = this.loadAuthContext(userId);
    this.authContextInFlight.set(userId, request);

    try {
      const value = await request;
      this.authContextCache.set(userId, {
        expiresAt: Date.now() + this.authContextCacheMs,
        value,
      });
      return value;
    } finally {
      this.authContextInFlight.delete(userId);
    }
  }

  private async loadAuthContext(userId: string): Promise<AuthenticatedUser> {
    const [row] = await this.sequelize.query<AuthContextRow>(
      `
        SELECT
          u.id AS "userId",
          u.name,
          u.national_id_last4 AS "nationalIdLast4",
          u.must_change_password AS "mustChangePassword",
          u."branchId" AS "fallbackBranchId",
          COALESCE(
            json_agg(
              json_build_object(
                'roleId', ur."roleId",
                'resourceId', ur."resourceId",
                'branchName', b.name
              )
              ORDER BY ur."roleId" DESC
            ) FILTER (WHERE ur."userId" IS NOT NULL),
            '[]'::json
          ) AS roles
        FROM public."user" u
        LEFT JOIN public.user_roles ur
          ON ur."userId" = u.id
          AND ur."deletedAt" IS NULL
        LEFT JOIN public.branch b
          ON b.id = COALESCE(NULLIF(ur."resourceId", ''), u."branchId")
          AND b."deletedAt" IS NULL
          AND b."isActive" = true
        WHERE u.id = :userId
          AND u."deletedAt" IS NULL
          AND u.is_active = true
        GROUP BY
          u.id,
          u.name,
          u.national_id_last4,
          u.must_change_password,
          u."branchId"
      `,
      {
        replacements: { userId },
        type: QueryTypes.SELECT,
      },
    );

    if (!row) {
      throw this.invalidCredentials();
    }

    const roleRows: AuthContextRoleRow[] =
      typeof row.roles === 'string' ? JSON.parse(row.roles) : row.roles;
    const roles = roleRows.map((roleRow) => {
      const branchId = String(roleRow.resourceId || row.fallbackBranchId || '');
      const configuredBranchName = branchId
        ? BRANCH_DISPLAY_BY_ID[branchId]?.name
        : undefined;

      return {
        role: ROLE_ID_TO_NAME[roleRow.roleId] || 'UNKNOWN',
        roleId: roleRow.roleId,
        branchId,
        branchName: configuredBranchName || roleRow.branchName || '',
      };
    });

    if (!roles.length) {
      throw new UnauthorizedException('No active permissions');
    }

    return {
      userId: row.userId,
      name: row.name || '',
      nationalIdLast4: row.nationalIdLast4 ?? null,
      nationalIdMasked: maskNationalIdLast4(row.nationalIdLast4),
      roles,
      activeBranch: roles.find((role) => role.branchId)?.branchId || '',
      mustChangePassword: Boolean(row.mustChangePassword),
    };
  }

  private getLoginNationalIdHash(identifier: string) {
    try {
      return getNationalIdDetails(identifier).nationalIdHash;
    } catch {
      throw this.invalidCredentials();
    }
  }

  private buildRoles(
    rows: Array<{ roleId: number; resourceId?: string | null }>,
    branchMap: Map<string, { name?: string }>,
    fallbackBranchId?: string | null,
  ) {
    return rows.map((r) => {
      const branchId = String(r.resourceId || fallbackBranchId || '');

      return {
        role: ROLE_ID_TO_NAME[r.roleId] || 'UNKNOWN',
        roleId: r.roleId,
        branchId,
        branchName: branchId ? branchMap.get(branchId)?.name || '' : '',
      };
    });
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
