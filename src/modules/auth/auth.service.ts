import { JwtService } from '@nestjs/jwt';
import UserRoleService from '../user-role/user-role.service';
import UserService from '../user/user.service';
import BranchService from '../branch/branch.service';
import { ROLE_ID_TO_NAME } from 'src/constants/auth.constants';
import { Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export default class AuthService {
  constructor(
    private readonly userRoleService: UserRoleService,
    private readonly userService: UserService,
    private readonly branchService: BranchService,
    private jwt: JwtService,
  ) {}

  async login(userId: string) {
    const rows = await this.userRoleService.findRolesByUserId(userId);

    if (!rows.length) {
      throw new UnauthorizedException('no permissions');
    }

    // Get branch info for each role
    const branches = await this.branchService.getAllBranches();
    const branchMap = new Map(branches.map((b) => [b.id, b]));

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
    const branchMap = new Map(branches.map((b) => [b.id, b]));

    const roles = rows.map((r) => ({
      role: ROLE_ID_TO_NAME[r.roleId] || 'UNKNOWN',
      roleId: r.roleId,
      branchId: r.resourceId as unknown as string,
      branchName: branchMap.get(r.resourceId as unknown as string)?.name || '',
    }));

    const activeBranch = roles[0]?.branchId || '';

    return { userId, name: user?.name || '', roles, activeBranch };
  }
}
