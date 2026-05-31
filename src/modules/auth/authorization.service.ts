import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AUTH_ROLES } from 'src/constants/auth.constants';
import Attendee from '../attendee/entities/attendee.entity';
import Event from '../event/entities/event.entity';
import MentorAssignment from '../mentor-assignment/entities/mentor-assignment.entity';
import User from '../user/entities/user.entity';
import UserRole from '../user-role/enitites/user-role.entity';

type AuthRole = {
  roleId: number;
  branchId?: string;
  resourceId?: string;
};

export type AuthUser = {
  userId?: string;
  sub?: string;
  roles?: AuthRole[];
  activeBranch?: string;
};

@Injectable()
export class AuthorizationService {
  getActorId(user: AuthUser) {
    return user.userId ?? user.sub;
  }

  isSuperAdmin(user: AuthUser) {
    return this.hasRole(user, AUTH_ROLES.SUPER_ADMIN.id);
  }

  hasRole(user: AuthUser, roleId: number) {
    return user.roles?.some((role) => role.roleId === roleId) ?? false;
  }

  hasBranchAccess(user: AuthUser, branchId: string) {
    if (this.isSuperAdmin(user)) {
      return true;
    }

    return (
      user.roles?.some((role) => this.getRoleBranchId(role) === branchId) ??
      false
    );
  }

  hasAdminAccess(user: AuthUser, branchId: string) {
    if (this.isSuperAdmin(user)) {
      return true;
    }

    return (
      user.roles?.some(
        (role) =>
          role.roleId === AUTH_ROLES.BRANCH_ADMIN.id &&
          this.getRoleBranchId(role) === branchId,
      ) ?? false
    );
  }

  assertSuperAdmin(user: AuthUser) {
    if (!this.isSuperAdmin(user)) {
      throw new ForbiddenException('Super admin role is required');
    }
  }

  assertBranchAccess(user: AuthUser, branchId: string) {
    this.assertBranchId(branchId);

    if (!this.hasBranchAccess(user, branchId)) {
      throw new ForbiddenException('Branch access denied');
    }
  }

  assertAdminForBranch(user: AuthUser, branchId: string) {
    this.assertBranchId(branchId);

    if (!this.hasAdminAccess(user, branchId)) {
      throw new ForbiddenException('Admin role is required for this branch');
    }
  }

  assertAdminForRequestedBranch(user: AuthUser, branchId?: string) {
    if (!branchId && this.isSuperAdmin(user)) {
      return;
    }

    this.assertAdminForBranch(user, branchId ?? '');
  }

  async assertBranchAccessForEvent(user: AuthUser, eventId: string) {
    const branchId = await this.getEventBranchId(eventId);
    this.assertBranchAccess(user, branchId);
    return branchId;
  }

  async assertAdminForEvent(user: AuthUser, eventId: string) {
    const branchId = await this.getEventBranchId(eventId);
    this.assertAdminForBranch(user, branchId);
    return branchId;
  }

  async assertAdminForAttendee(user: AuthUser, attendeeId: string) {
    const branchId = await this.getAttendeeBranchId(attendeeId);
    this.assertAdminForBranch(user, branchId);
    return branchId;
  }

  async assertSelfAttendeeOrAdmin(user: AuthUser, attendeeId: string) {
    const attendee = await Attendee.findByPk(attendeeId, {
      include: [{ model: Event, attributes: ['id', 'branchId'] }],
    });

    if (!attendee) {
      throw new NotFoundException('Attendee not found');
    }

    const branchId = attendee.event?.branchId;
    if (!branchId) {
      throw new NotFoundException('Event not found');
    }

    if (attendee.userId === this.getActorId(user)) {
      return branchId;
    }

    this.assertAdminForBranch(user, branchId);
    return branchId;
  }

  async assertAdminForAssignment(user: AuthUser, assignmentId: string) {
    const branchId = await this.getAssignmentBranchId(assignmentId);
    this.assertAdminForBranch(user, branchId);
    return branchId;
  }

  async assertSelfOrAdminForUser(user: AuthUser, targetUserId: string) {
    if (targetUserId === this.getActorId(user)) {
      return;
    }

    if (this.isSuperAdmin(user)) {
      return;
    }

    const branchIds = await this.getUserBranchIds(targetUserId);
    const hasAdminAccess = branchIds.some((branchId) =>
      this.hasAdminAccess(user, branchId),
    );

    if (!hasAdminAccess) {
      throw new ForbiddenException('User access denied');
    }
  }

  async assertUserBelongsToBranch(userId: string, branchId: string) {
    const branchIds = await this.getUserBranchIds(userId);

    if (!branchIds.includes(branchId)) {
      throw new ForbiddenException('User does not belong to this branch');
    }
  }

  async assertUserHasRole(userId: string, roleId: number) {
    const role = await UserRole.findOne({ where: { userId, roleId } });

    if (!role) {
      throw new ForbiddenException('User role is not allowed for this action');
    }
  }

  async getEventBranchId(eventId: string) {
    const event = await Event.findByPk(eventId, {
      attributes: ['id', 'branchId'],
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    this.assertBranchId(event.branchId);
    return event.branchId;
  }

  async getAttendeeBranchId(attendeeId: string) {
    const attendee = await Attendee.findByPk(attendeeId, {
      include: [{ model: Event, attributes: ['id', 'branchId'] }],
    });

    if (!attendee) {
      throw new NotFoundException('Attendee not found');
    }

    const branchId = attendee.event?.branchId;
    if (!branchId) {
      throw new NotFoundException('Event not found');
    }

    return branchId;
  }

  async getAssignmentBranchId(assignmentId: string) {
    const assignment = await MentorAssignment.findByPk(assignmentId, {
      attributes: ['id', 'branchId'],
    });

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    this.assertBranchId(assignment.branchId);
    return assignment.branchId;
  }

  async getUserBranchIds(userId: string) {
    const user = await User.findByPk(userId, {
      include: [{ model: UserRole }],
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const branchIds = new Set<string>();
    if (user.branchId) {
      branchIds.add(user.branchId);
    }

    user.userRoles?.forEach((role) => {
      if (role.resourceId) {
        branchIds.add(String(role.resourceId));
      }
    });

    if (branchIds.size === 0) {
      throw new ForbiddenException('User has no branch access');
    }

    return Array.from(branchIds);
  }

  private assertBranchId(branchId?: string | null) {
    if (!branchId) {
      throw new ForbiddenException('Branch scope is required');
    }
  }

  private getRoleBranchId(role: AuthRole) {
    return role.branchId ?? role.resourceId;
  }
}
