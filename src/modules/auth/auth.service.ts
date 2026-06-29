import { JwtService } from '@nestjs/jwt';
import UserService from '../user/user.service';
import BranchService from '../branch/branch.service';
import UserRoleService from '../user-role/user-role.service';
import { ROLE_ID_TO_NAME } from 'src/constants/auth.constants';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import axios from 'axios';
import {
  getIntegerEnv,
  getOptionalEnv,
  getRequiredEnv,
} from 'src/config/env.util';
import {
  assertNationalIdHashSecretConfigured,
  getNationalIdDetails,
  maskNationalIdLast4,
} from '../user/national-id.util';

type LoginAttempt = {
  failedCount: number;
  lockedUntil: number;
};

@Injectable()
export default class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly loginAttempts = new Map<string, LoginAttempt>();
  private readonly maxLoginAttempts = getIntegerEnv('AUTH_MAX_ATTEMPTS', 5);
  private readonly lockoutMs = getIntegerEnv('AUTH_LOCKOUT_SECONDS', 300) * 1000;
  private readonly maxLoginAttemptRecords = getIntegerEnv(
    'AUTH_MAX_ATTEMPT_RECORDS',
    5000,
  );

  constructor(
    private readonly userRoleService: UserRoleService,
    private readonly userService: UserService,
    private readonly branchService: BranchService,
    private jwt: JwtService,
  ) {
    assertNationalIdHashSecretConfigured();
  }

  async login(nationalId: string, loginCode: string, recaptchaToken?: string) {
    const nationalIdDetails = getNationalIdDetails(nationalId);
    const attemptKey = nationalIdDetails.nationalIdHash;

    this.assertLoginAllowed(attemptKey);
    await this.verifyRecaptchaIfConfigured(attemptKey, recaptchaToken);
    this.verifyLoginCode(attemptKey, loginCode);

    const user = await this.userService.findByNationalIdHash(
      nationalIdDetails.nationalIdHash,
    );

    if (!user) {
      this.registerFailedLogin(attemptKey);
      this.logger.warn('Login denied: invalid credentials');
      throw new UnauthorizedException('invalid credentials');
    }

    const userId = user.id;
    const rows = await this.userRoleService.findRolesByUserId(userId);

    if (!rows.length) {
      this.registerFailedLogin(attemptKey);
      this.logger.warn('Login denied: no permissions');
      throw new UnauthorizedException('no permissions');
    }

    // Get branch info for each role
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

    const payload = {
      sub: userId,
      roles,
      activeBranch,
    };

    const token = this.jwt.sign(payload);
    this.loginAttempts.delete(attemptKey);
    this.logger.log('Successful login');

    return {
      token,
      roles,
      activeBranch,
    };
  }

  async getMe(userId: string) {
    const [rows, user, branches] = await Promise.all([
      this.userRoleService.findRolesByUserId(userId),
      this.userService.findById(userId),
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

    return {
      userId,
      name: user?.name || '',
      nationalIdLast4: user?.nationalIdLast4 ?? null,
      nationalIdMasked: maskNationalIdLast4(user?.nationalIdLast4),
      roles,
      activeBranch,
    };
  }

  private verifyLoginCode(attemptKey: string, loginCode: string) {
    const expectedCode = getRequiredEnv('AUTH_LOGIN_CODE');
    const provided = Buffer.from(loginCode);
    const expected = Buffer.from(expectedCode);

    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      this.registerFailedLogin(attemptKey);
      this.logger.warn('Failed login attempt');
      throw new UnauthorizedException('invalid credentials');
    }
  }

  private assertLoginAllowed(attemptKey: string) {
    const attempt = this.loginAttempts.get(attemptKey);

    if (!attempt) {
      return;
    }

    if (attempt.lockedUntil && attempt.lockedUntil <= Date.now()) {
      this.loginAttempts.delete(attemptKey);
      return;
    }

    if (!attempt.lockedUntil) {
      return;
    }

    throw new UnauthorizedException('too many login attempts');
  }

  private registerFailedLogin(attemptKey: string) {
    this.pruneLoginAttempts();

    const current = this.loginAttempts.get(attemptKey) ?? {
      failedCount: 0,
      lockedUntil: 0,
    };
    const failedCount = current.failedCount + 1;
    const lockedUntil =
      failedCount >= this.maxLoginAttempts ? Date.now() + this.lockoutMs : 0;

    this.loginAttempts.set(attemptKey, { failedCount, lockedUntil });
  }

  private pruneLoginAttempts() {
    if (this.loginAttempts.size < this.maxLoginAttemptRecords) {
      return;
    }

    const now = Date.now();
    for (const [attemptKey, attempt] of this.loginAttempts.entries()) {
      if (!attempt.lockedUntil || attempt.lockedUntil <= now) {
        this.loginAttempts.delete(attemptKey);
      }

      if (this.loginAttempts.size < this.maxLoginAttemptRecords) {
        return;
      }
    }
  }

  private async verifyRecaptchaIfConfigured(
    attemptKey: string,
    recaptchaToken?: string,
  ) {
    const secret = getOptionalEnv('RECAPTCHA_SECRET_KEY');
    if (!secret) {
      return;
    }

    if (!recaptchaToken) {
      this.registerFailedLogin(attemptKey);
      this.logger.warn('Login denied: missing recaptcha');
      throw new UnauthorizedException('recaptcha is required');
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
      .catch(() => {
        this.registerFailedLogin(attemptKey);
        this.logger.warn('Login denied: recaptcha error');
        throw new UnauthorizedException('recaptcha verification failed');
      });

    if (!response.data?.success) {
      this.registerFailedLogin(attemptKey);
      this.logger.warn('Login denied: recaptcha failed');
      throw new UnauthorizedException('recaptcha verification failed');
    }
  }
}
