import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AUTH_ROLES } from 'src/constants/auth.constants';
import UserService from '../user/user.service';
import EventService from '../event/event.service';
import ActivityRepository from './activity.repository';
import {
  EndVolunteerActivityDto,
  StartVolunteerActivityDto,
  VolunteerActivityAdminQueryDto,
} from './dtos/activity.dto';
import VolunteerActivity from './entities/activity.entity';
import {
  ACTIVITY_TIMEZONE,
  VolunteerActivityStatus,
} from './activity.constants';
import { applyBranchDisplay } from 'src/constants/auth.constants';
import {
  calculateDurationMinutes,
  formatDurationMinutes,
  getCurrentYearInTimeZone,
  getZonedDateParts,
  parseActivityDateFilter,
} from './activity.utils';

type AuthRole = {
  roleId: number;
  branchId?: string;
  resourceId?: string;
};

type AuthUser = {
  userId: string;
  roles?: AuthRole[];
  activeBranch?: string;
};

@Injectable()
export default class ActivityService {
  constructor(
    private readonly activityRepository: ActivityRepository,
    private readonly userService: UserService,
    private readonly eventService: EventService,
  ) {}

  public async startActivity(
    authUser: AuthUser,
    dto: StartVolunteerActivityDto,
  ) {
    this.ensureVolunteerAccess(authUser);
    const eventId = dto.eventId.trim();
    const traineeId = dto.traineeId.trim();

    const existingActivity = await this.activityRepository.findActiveByVolunteer(
      authUser.userId,
    );

    if (existingActivity) {
      throw new ConflictException('Volunteer already has an active activity');
    }

    const [volunteer, trainee, event] = await Promise.all([
      this.userService.findById(authUser.userId),
      this.userService.findById(traineeId),
      this.eventService.findById(eventId),
    ]);

    if (!volunteer) {
      throw new NotFoundException('Volunteer not found');
    }

    if (!trainee) {
      throw new NotFoundException('Trainee not found');
    }

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    this.ensureUserHasRole(trainee.userRoles, AUTH_ROLES.TRAINEE.id, 'Selected user is not a trainee');

    const volunteerBranchId =
      volunteer.branchId ?? authUser.activeBranch ?? this.getFirstBranchId(authUser);
    const traineeBranchId = trainee.branchId ?? volunteerBranchId;
    const eventBranchId = event.branchId ?? volunteerBranchId;

    this.ensureBranchCompatibility(
      volunteerBranchId,
      traineeBranchId,
      'Selected trainee does not belong to the volunteer branch',
    );
    this.ensureBranchCompatibility(
      volunteerBranchId,
      eventBranchId,
      'Selected event does not belong to the volunteer branch',
    );

    if (volunteerBranchId) {
      this.ensureBranchPermission(authUser, volunteerBranchId);
    }

    const activity = await this.activityRepository.create({
      volunteerId: authUser.userId,
      traineeId,
      eventId,
      branchId: eventBranchId ?? traineeBranchId ?? volunteerBranchId ?? null,
      startTime: new Date(),
      status: VolunteerActivityStatus.ACTIVE,
      notes: null,
    });

    const savedActivity = await this.activityRepository.findById(activity.id);

    return this.toActivityResponse(savedActivity ?? activity);
  }

  public async endActivity(
    authUser: AuthUser,
    activityId: string,
    dto: EndVolunteerActivityDto,
  ) {
    this.ensureVolunteerAccess(authUser);

    const activity = await this.activityRepository.findById(activityId);

    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    if (activity.volunteerId !== authUser.userId) {
      throw new ForbiddenException('You can only end your own activity');
    }

    if (activity.status !== VolunteerActivityStatus.ACTIVE) {
      throw new ConflictException('Only active activities can be ended');
    }

    if (!activity.startTime) {
      throw new BadRequestException('Active activity is missing a valid start time');
    }

    const endTime = new Date();

    if (endTime.getTime() < new Date(activity.startTime).getTime()) {
      throw new BadRequestException('End time must be after start time');
    }

    await activity.update({
      endTime,
      status: VolunteerActivityStatus.COMPLETED,
      notes: dto.notes?.trim() || null,
    });

    const updatedActivity = await this.activityRepository.findById(activity.id);
    return this.toActivityResponse(updatedActivity ?? activity);
  }

  public async getMyActiveActivity(authUser: AuthUser) {
    this.ensureVolunteerAccess(authUser);
    const activity = await this.activityRepository.findActiveByVolunteer(
      authUser.userId,
    );

    return activity ? this.toActivityResponse(activity) : null;
  }

  public async getMyHistory(authUser: AuthUser, limit?: string) {
    this.ensureVolunteerAccess(authUser);

    const parsedLimit = Number(limit);
    const resolvedLimit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 100)
        : 20;

    const activities = await this.activityRepository.findHistoryByVolunteer(
      authUser.userId,
      resolvedLimit,
    );

    return activities.map((activity) => this.toActivityResponse(activity));
  }

  public async getMyYearlySummary(authUser: AuthUser) {
    this.ensureVolunteerAccess(authUser);

    const activities = await this.activityRepository.findCompletedByVolunteer(
      authUser.userId,
    );
    const year = getCurrentYearInTimeZone(ACTIVITY_TIMEZONE);

    const totalMinutes = activities.reduce((sum, activity) => {
      if (!activity.startTime || !activity.endTime) {
        return sum;
      }

      const activityYear = getZonedDateParts(activity.startTime).year;
      if (activityYear !== year) {
        return sum;
      }

      return sum + (calculateDurationMinutes(activity.startTime, activity.endTime) ?? 0);
    }, 0);

    return {
      totalMinutes,
      totalHoursDecimal: Number((totalMinutes / 60).toFixed(2)),
      formatted: formatDurationMinutes(totalMinutes) ?? '0m',
      year,
      timezone: ACTIVITY_TIMEZONE,
    };
  }

  public async getAdminActivities(
    authUser: AuthUser,
    query: VolunteerActivityAdminQueryDto,
  ) {
    const { isSuperAdmin, branchIds } = this.getAdminScope(authUser);
    const requestedBranchId = query.branchId?.trim() || undefined;

    if (requestedBranchId && !isSuperAdmin && !branchIds.includes(requestedBranchId)) {
      throw new ForbiddenException('You do not have access to this branch');
    }

    const activities = await this.activityRepository.findAdminActivities({
      branchIds: requestedBranchId
        ? [requestedBranchId]
        : isSuperAdmin
          ? undefined
          : branchIds,
      volunteerId: query.volunteerId?.trim() || undefined,
      traineeId: query.traineeId?.trim() || undefined,
      eventId: query.eventId?.trim() || undefined,
      status: query.status,
      startDate: parseActivityDateFilter(query.startDate, 'start'),
      endDate: parseActivityDateFilter(query.endDate, 'end'),
    });

    return activities.map((activity) => this.toActivityResponse(activity));
  }

  public async getAdminActivityById(authUser: AuthUser, activityId: string) {
    const { isSuperAdmin, branchIds } = this.getAdminScope(authUser);
    const activity = await this.activityRepository.findById(activityId);

    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    if (
      !isSuperAdmin &&
      activity.branchId &&
      !branchIds.includes(activity.branchId)
    ) {
      throw new ForbiddenException('You do not have access to this activity');
    }

    return this.toActivityResponse(activity);
  }

  public async getEventAttendance(authUser: AuthUser, eventId: string) {
    const normalizedEventId = eventId.trim();
    await this.ensureAdminAccessToEvent(authUser, normalizedEventId);
    const activities = await this.activityRepository.findAttendanceByEvent(
      normalizedEventId,
    );
    const volunteerMap = new Map<string, { volunteerId: string; name: string }>();

    for (const activity of activities) {
      if (!activity.volunteerId || volunteerMap.has(activity.volunteerId)) {
        continue;
      }

      volunteerMap.set(activity.volunteerId, {
        volunteerId: activity.volunteerId,
        name: activity.volunteer?.name ?? activity.volunteerId,
      });
    }

    return Array.from(volunteerMap.values()).sort((first, second) =>
      first.name.localeCompare(second.name, 'he'),
    );
  }

  public async removeEventAttendance(
    authUser: AuthUser,
    eventId: string,
    volunteerId: string,
  ) {
    const normalizedEventId = eventId.trim();
    const normalizedVolunteerId = volunteerId.trim();
    await this.ensureAdminAccessToEvent(authUser, normalizedEventId);
    await this.activityRepository.removeVolunteerAttendanceForEvent(
      normalizedEventId,
      normalizedVolunteerId,
    );
    return this.getEventAttendance(authUser, normalizedEventId);
  }

  private toActivityResponse(activity: VolunteerActivity) {
    const branch = applyBranchDisplay(activity.branch);
    const durationMinutes = calculateDurationMinutes(
      activity.startTime,
      activity.endTime,
    );

    return {
      id: activity.id,
      volunteerId: activity.volunteerId,
      traineeId: activity.traineeId,
      eventId: activity.eventId,
      branchId: activity.branchId,
      startTime: activity.startTime,
      endTime: activity.endTime,
      status: activity.status,
      notes: activity.notes ?? '',
      createdAt: activity.createdAt,
      updatedAt: activity.updatedAt,
      durationMinutes,
      durationFormatted: formatDurationMinutes(durationMinutes),
      timezone: ACTIVITY_TIMEZONE,
      volunteer: activity.volunteer,
      trainee: activity.trainee,
      event: activity.event,
      branch,
    };
  }

  private ensureVolunteerAccess(authUser: AuthUser) {
    const hasVolunteerRole = authUser.roles?.some(
      (role) => role.roleId === AUTH_ROLES.VOLUNTEER.id,
    );

    if (!hasVolunteerRole) {
      throw new ForbiddenException('Only volunteers can perform this action');
    }
  }

  private getAdminScope(authUser: AuthUser) {
    const roles = authUser.roles ?? [];
    const isSuperAdmin = roles.some(
      (role) => role.roleId === AUTH_ROLES.SUPER_ADMIN.id,
    );
    const branchIds = roles
      .filter((role) => role.roleId === AUTH_ROLES.BRANCH_ADMIN.id)
      .map((role) => this.getRoleBranchId(role))
      .filter((branchId): branchId is string => !!branchId);

    if (!isSuperAdmin && branchIds.length === 0) {
      throw new ForbiddenException('Only admins can access activity reports');
    }

    return { isSuperAdmin, branchIds };
  }

  private async ensureAdminAccessToEvent(authUser: AuthUser, eventId: string) {
    const { isSuperAdmin, branchIds } = this.getAdminScope(authUser);
    const event = await this.eventService.findById(eventId);

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    if (!isSuperAdmin && event.branchId && !branchIds.includes(event.branchId)) {
      throw new ForbiddenException('You do not have access to this event');
    }

    return event;
  }

  private ensureBranchPermission(authUser: AuthUser, branchId: string) {
    const hasBranchAccess = authUser.roles?.some(
      (role) =>
        role.roleId === AUTH_ROLES.SUPER_ADMIN.id ||
        this.getRoleBranchId(role) === branchId,
    );

    if (!hasBranchAccess) {
      throw new ForbiddenException('You do not have access to this branch');
    }
  }

  private ensureBranchCompatibility(
    expectedBranchId?: string | null,
    actualBranchId?: string | null,
    errorMessage = 'Branch mismatch',
  ) {
    if (
      expectedBranchId &&
      actualBranchId &&
      expectedBranchId !== actualBranchId
    ) {
      throw new ForbiddenException(errorMessage);
    }
  }

  private ensureUserHasRole(
    roles: Array<{ roleId: number }> | undefined,
    expectedRoleId: number,
    errorMessage: string,
  ) {
    const hasRole = roles?.some((role) => role.roleId === expectedRoleId);

    if (!hasRole) {
      throw new BadRequestException(errorMessage);
    }
  }

  private getFirstBranchId(authUser: AuthUser) {
    const role = authUser.roles?.find((currentRole) =>
      this.getRoleBranchId(currentRole),
    );
    return role ? this.getRoleBranchId(role) : undefined;
  }

  private getRoleBranchId(role: AuthRole) {
    return role.branchId ?? role.resourceId;
  }
}
