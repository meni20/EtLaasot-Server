import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Transaction, UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import AttendeeRepository from './attendee.repository';
import { AUTH_ROLES } from 'src/constants/auth.constants';
import Event from '../event/entities/event.entity';
import MentorAssignment from '../mentor-assignment/entities/mentor-assignment.entity';
import User from '../user/entities/user.entity';
import UserRole from '../user-role/enitites/user-role.entity';
import { AttendanceIntent, AttendeeRsvpStatus } from './attendee.constants';
import {
  AuthorizationService,
  type AuthUser,
} from '../auth/authorization.service';
import {
  matchesEventAudience,
  userAudienceActor,
} from '../event/event-audience';
import type { UserGender } from '../user/interfaces/user.interface';

type AuthenticatedUser = {
  userId?: string;
  sub?: string;
  roles?: { roleId: number; branchId?: string; resourceId?: string }[];
  activeBranch?: string;
};

export interface EventAssignmentCounterpart {
  name: string;
  gender: UserGender | null;
}

export interface EventAssignmentRecipient {
  userId: string;
  name: string;
  email: string | null;
  gender: UserGender | null;
  role: 'mentor' | 'trainee' | 'attendee';
  assignments: EventAssignmentCounterpart[];
}

@Injectable()
export default class AttendeeService {
  constructor(
    private readonly attendeeRepository: AttendeeRepository,
    private readonly sequelize: Sequelize,
    private readonly authorization: AuthorizationService,
  ) {}

  public async addAttendee(userId: string, eventId: string, actor: AuthUser) {
    return this.sequelize.transaction(async (transaction) => {
      const event = await this.authorization.lockEvent(eventId, transaction);
      this.authorization.assertAdminForBranch(actor, event.branchId);
      await this.authorization.assertUserBelongsToBranch(
        userId,
        event.branchId,
      );
      await this.authorization.assertEligibleParticipants(
        [userId],
        event,
        transaction,
      );
      return this.toSafeAttendee(
        await this.attendeeRepository.createAttendee(
          userId,
          eventId,
          transaction,
        ),
      );
    });
  }

  public async joinEvent(
    userId: string,
    eventId: string,
    rsvpStatus: AttendeeRsvpStatus,
    actor: AuthUser,
  ) {
    return this.sequelize.transaction(async (transaction) => {
      const event = await this.authorization.lockEvent(eventId, transaction);
      this.authorization.assertEventAccess(actor, event);
      await this.authorization.assertEligibleParticipants(
        [userId],
        event,
        transaction,
      );
      return this.toSafeAttendee(
        await this.attendeeRepository.createAndConfirm(
          userId,
          eventId,
          rsvpStatus,
          transaction,
        ),
      );
    });
  }

  public async getAllAttendeesByEvent(eventId: string) {
    try {
      const attendees =
        await this.attendeeRepository.getAttendeesByEvent(eventId);
      return attendees.map((attendee) => this.toSafeAttendee(attendee));
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to fetch attendees by event',
      );
    }
  }

  public async getRegisteredEventsByUser(
    userId: string,
    actor: AuthenticatedUser,
  ) {
    const branchIds = this.getAdminBranchFilter(actor);
    const attendees = await this.attendeeRepository.getRegisteredEventsByUser(
      userId,
      branchIds,
    );

    const now = Date.now();
    return attendees
      .map((attendee) => {
        const plainAttendee = this.toSafeAttendee(attendee);
        return {
          attendeeId: plainAttendee.id,
          rsvpStatus: plainAttendee.rsvpStatus,
          rsvpDate: plainAttendee.rsvpDate,
          checkedIn: plainAttendee.checkedIn,
          event: plainAttendee.event,
        };
      })
      .filter((entry) => !!entry.event)
      .sort((first, second) => {
        const firstStart = new Date(first.event.startDate).getTime();
        const secondStart = new Date(second.event.startDate).getTime();
        const firstUpcoming = firstStart >= now;
        const secondUpcoming = secondStart >= now;

        if (firstUpcoming !== secondUpcoming) {
          return firstUpcoming ? -1 : 1;
        }

        return firstUpcoming
          ? firstStart - secondStart
          : secondStart - firstStart;
      });
  }

  public async updateRsvp(
    attendeeId: string,
    rsvpStatus: AttendeeRsvpStatus,
    actor: AuthUser,
  ) {
    const attendee = await this.attendeeRepository.findById(attendeeId);
    if (!attendee) throw new NotFoundException('Attendee not found');
    return this.sequelize.transaction(async (transaction) => {
      const event = await this.authorization.lockEvent(
        attendee.eventId,
        transaction,
      );
      this.authorization.assertEventAccess(actor, event);
      if (attendee.userId !== this.authorization.getActorId(actor))
        this.authorization.assertAdminForBranch(actor, event.branchId);
      await this.authorization.assertEligibleParticipants(
        [attendee.userId],
        event,
        transaction,
      );
      return this.attendeeRepository.updateRsvp(
        attendeeId,
        rsvpStatus,
        transaction,
      );
    });
  }

  public async checkIn(attendeeId: string, checkedInBy: string) {
    try {
      return await this.attendeeRepository.checkIn(attendeeId, checkedInBy);
    } catch (error) {
      throw new InternalServerErrorException('Failed to check in attendee');
    }
  }

  public async deleteAttendee(attendeeId: string) {
    try {
      return await this.sequelize.transaction(async (transaction) => {
        const attendee = await this.attendeeRepository.findById(attendeeId);
        if (!attendee) {
          throw new NotFoundException('Attendee not found');
        }

        await this.attendeeRepository.removePairingsForUsers(
          attendee.eventId,
          [attendee.userId],
          transaction,
        );

        return await this.attendeeRepository.deleteAttendee(
          attendeeId,
          transaction,
        );
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException('Failed to delete attendee');
    }
  }

  public async updateAttendanceIntent(
    eventId: string,
    intent: AttendanceIntent,
    actor: AuthenticatedUser,
  ) {
    const actorId = this.getActorId(actor);
    await this.sequelize.transaction(async (transaction) => {
      const event = await this.authorization.lockEvent(eventId, transaction);
      this.authorization.assertEventAccess(actor, event);
      const traineeMode =
        this.actorHasRole(actor, AUTH_ROLES.TRAINEE.id) &&
        (event.audience === 'TRAINEES' ||
          !this.actorHasRole(actor, AUTH_ROLES.VOLUNTEER.id));
      if (traineeMode) {
        await this.updateTraineeAttendanceIntent(
          eventId,
          intent,
          actor,
          actorId,
          event,
          transaction,
        );
      } else if (this.actorHasRole(actor, AUTH_ROLES.VOLUNTEER.id)) {
        await this.updateVolunteerAttendanceIntent(
          eventId,
          intent,
          actor,
          actorId,
          event,
          transaction,
        );
      } else {
        throw new ForbiddenException('Volunteer or trainee role is required');
      }
    });
    return this.getParticipantsByEvent(eventId, actor);
  }

  private async updateVolunteerAttendanceIntent(
    eventId: string,
    intent: AttendanceIntent,
    actor: AuthenticatedUser,
    volunteerId: string,
    event: Event,
    transaction: Transaction,
  ) {
    this.assertVolunteer(actor);

    if (
      intent !== AttendanceIntent.VOLUNTEER_ONLY &&
      intent !== AttendanceIntent.NONE
    ) {
      throw new BadRequestException(
        'Volunteers can only update their own attendance',
      );
    }

    const assignment = await MentorAssignment.findOne({
      where: {
        mentorId: volunteerId,
        branchId: event.branchId,
        isActive: true,
      },
      order: [['startDate', 'DESC']],
    });
    const traineeId = assignment?.traineeId;

    await this.assertUsersBelongToBranch([volunteerId], event.branchId);

    if (intent === AttendanceIntent.VOLUNTEER_ONLY) {
      await this.attendeeRepository.ensureAttendee(
        volunteerId,
        eventId,
        transaction,
      );
      if (traineeId) {
        await this.tryCreateAssignedPairingIfCounterpartAttending(
          eventId,
          event,
          volunteerId,
          traineeId,
          volunteerId,
          transaction,
        );
      }
    }

    if (intent === AttendanceIntent.NONE) {
      await this.attendeeRepository.removePairingsForUsers(
        eventId,
        [volunteerId],
        transaction,
      );
      await this.attendeeRepository.removeAttendee(
        volunteerId,
        eventId,
        transaction,
      );
    }
  }

  private async updateTraineeAttendanceIntent(
    eventId: string,
    intent: AttendanceIntent,
    actor: AuthenticatedUser,
    traineeId: string,
    event: Event,
    transaction: Transaction,
  ) {
    this.assertTrainee(actor);

    if (
      intent !== AttendanceIntent.TRAINEE_ONLY &&
      intent !== AttendanceIntent.NONE
    ) {
      throw new BadRequestException(
        'Trainees can only update their own attendance',
      );
    }

    await this.assertUsersBelongToBranch([traineeId], event.branchId);

    const assignment = await MentorAssignment.findOne({
      where: {
        traineeId,
        branchId: event.branchId,
        isActive: true,
      },
      order: [['startDate', 'DESC']],
    });
    const volunteerId = assignment?.mentorId;

    if (intent === AttendanceIntent.TRAINEE_ONLY) {
      await this.attendeeRepository.ensureAttendee(
        traineeId,
        eventId,
        transaction,
      );
      if (volunteerId) {
        await this.tryCreateAssignedPairingIfCounterpartAttending(
          eventId,
          event,
          volunteerId,
          traineeId,
          traineeId,
          transaction,
        );
      }
    }

    if (intent === AttendanceIntent.NONE) {
      await this.attendeeRepository.removePairingsForUsers(
        eventId,
        [traineeId],
        transaction,
      );
      await this.attendeeRepository.removeAttendee(
        traineeId,
        eventId,
        transaction,
      );
    }
  }

  private async tryCreateAssignedPairingIfCounterpartAttending(
    eventId: string,
    event: Event,
    volunteerId: string,
    traineeId: string,
    attendingUserId: string,
    transaction: Transaction,
  ) {
    try {
      await this.authorization.assertEligibleParticipants(
        [volunteerId, traineeId],
        event,
        transaction,
      );
    } catch (error) {
      if (error instanceof ForbiddenException) return;
      throw error;
    }
    const counterpartId =
      attendingUserId === volunteerId ? traineeId : volunteerId;
    const counterpartAttendee =
      await this.attendeeRepository.findAttendeeByUserEvent(
        counterpartId,
        eventId,
        transaction,
      );

    if (!counterpartAttendee) {
      return;
    }

    await this.assertUsersBelongToBranch(
      [volunteerId, traineeId],
      event.branchId,
    );

    await this.attendeeRepository.createPairingIfUsersUnpaired(
      eventId,
      volunteerId,
      traineeId,
      event.branchId,
      transaction,
    );
  }

  public async getParticipantsByEvent(
    eventId: string,
    actor: AuthenticatedUser,
  ) {
    const event = await this.getEventOrThrow(eventId);
    this.authorization.assertEventAccess(actor, event);

    const { attendees, pairings } =
      await this.attendeeRepository.getStructuredParticipants(eventId);
    return this.buildParticipantsResponse(attendees, pairings);
  }

  public async getPrintableParticipantsByEvent(
    eventId: string,
    actor: AuthenticatedUser,
  ) {
    const event = await this.getEventOrThrow(eventId);
    this.assertAdmin(actor, event.branchId);

    const { attendees, pairings } =
      await this.attendeeRepository.getStructuredParticipants(eventId, {
        includePrintProfile: true,
      });

    return this.buildParticipantsResponse(attendees, pairings);
  }

  private buildParticipantsResponse(attendees: any[], pairings: any[]) {
    const pairedUserIds = new Set<string>();
    const paired = pairings.map((pairing) => {
      pairedUserIds.add(pairing.mentorId);
      pairedUserIds.add(pairing.traineeId);

      return {
        ...(pairing.toJSON() as Record<string, unknown>),
      };
    });

    const unpairedMentors = attendees.filter(
      (attendee) =>
        !pairedUserIds.has(attendee.userId) &&
        this.userHasRole(attendee.user, AUTH_ROLES.VOLUNTEER.id),
    );
    const unpairedTrainees = attendees.filter(
      (attendee) =>
        !pairedUserIds.has(attendee.userId) &&
        this.userHasRole(attendee.user, AUTH_ROLES.TRAINEE.id),
    );

    return {
      paired,
      unpairedMentors: unpairedMentors.map((attendee) =>
        this.toSafeAttendee(attendee),
      ),
      unpairedTrainees: unpairedTrainees.map((attendee) =>
        this.toSafeAttendee(attendee),
      ),
    };
  }

  public async getEventAssignmentRecipients(
    eventId: string,
  ): Promise<EventAssignmentRecipient[]> {
    const event = await this.getEventOrThrow(eventId);
    const { attendees, pairings } =
      await this.attendeeRepository.getStructuredParticipants(eventId, {
        includeAssignmentGender: true,
      });
    const attendeeUsers = new Map(attendees.map((a) => [a.userId, a.user]));
    const eligiblePairings = pairings.filter(
      (p) =>
        matchesEventAudience(
          userAudienceActor(attendeeUsers.get(p.mentorId) ?? {}),
          event,
        ) &&
        matchesEventAudience(
          userAudienceActor(attendeeUsers.get(p.traineeId) ?? {}),
          event,
        ),
    );
    const pairingByMentorId = new Map(
      eligiblePairings.map((pairing) => [pairing.mentorId, pairing]),
    );
    const pairingsByTraineeId = new Map<string, any[]>();
    eligiblePairings.forEach((pairing) => {
      const traineePairings = pairingsByTraineeId.get(pairing.traineeId) ?? [];
      traineePairings.push(pairing);
      pairingsByTraineeId.set(pairing.traineeId, traineePairings);
    });

    const seenUserIds = new Set<string>();
    const recipients: EventAssignmentRecipient[] = [];

    attendees.forEach((attendee) => {
      if (
        !matchesEventAudience(userAudienceActor(attendee.user ?? {}), event) ||
        seenUserIds.has(attendee.userId) ||
        attendee.rsvpStatus === AttendeeRsvpStatus.DECLINED
      ) {
        return;
      }

      seenUserIds.add(attendee.userId);
      const isMentor = this.userHasRole(attendee.user, AUTH_ROLES.VOLUNTEER.id);
      const isTrainee = this.userHasRole(attendee.user, AUTH_ROLES.TRAINEE.id);
      const role = isMentor ? 'mentor' : isTrainee ? 'trainee' : 'attendee';
      const mentorPairing = pairingByMentorId.get(attendee.userId);
      const assignments =
        role === 'mentor'
          ? mentorPairing
            ? [
                {
                  name: mentorPairing.trainee?.name ?? 'ללא שם',
                  gender: mentorPairing.trainee?.gender ?? null,
                },
              ]
            : []
          : role === 'trainee'
            ? (pairingsByTraineeId.get(attendee.userId) ?? []).map(
                (pairing) => ({
                  name: pairing.mentor?.name ?? 'ללא שם',
                  gender: pairing.mentor?.gender ?? null,
                }),
              )
            : [];

      recipients.push({
        userId: attendee.userId,
        name: attendee.user?.name ?? 'ללא שם',
        email: attendee.user?.email ?? null,
        gender: attendee.user?.gender ?? null,
        role,
        assignments,
      });
    });

    return recipients;
  }

  public async createManualPairing(
    eventId: string,
    mentorId: string,
    traineeId: string,
    actor: AuthenticatedUser,
  ) {
    const event = await this.getEventOrThrow(eventId);
    this.assertAdmin(actor, event.branchId);
    await this.assertUsersBelongToBranch([mentorId, traineeId], event.branchId);
    await this.assertUserRole(mentorId, AUTH_ROLES.VOLUNTEER.id);
    await this.assertUserRole(traineeId, AUTH_ROLES.TRAINEE.id);

    try {
      await this.sequelize.transaction(async (transaction) => {
        const lockedEvent = await this.authorization.lockEvent(
          eventId,
          transaction,
        );
        this.authorization.assertAdminForBranch(actor, lockedEvent.branchId);
        await this.assertUsersBelongToBranch(
          [mentorId, traineeId],
          lockedEvent.branchId,
        );
        await this.authorization.assertEligibleParticipants(
          [mentorId, traineeId],
          lockedEvent,
          transaction,
        );
        const [mentorAttendee, traineeAttendee] = await Promise.all([
          this.attendeeRepository.findAttendeeByUserEvent(
            mentorId,
            eventId,
            transaction,
          ),
          this.attendeeRepository.findAttendeeByUserEvent(
            traineeId,
            eventId,
            transaction,
          ),
        ]);

        if (!mentorAttendee || !traineeAttendee) {
          throw new BadRequestException('Both users must be event attendees');
        }

        const pairing = await this.attendeeRepository.createPairing(
          eventId,
          mentorId,
          traineeId,
          event.branchId,
          transaction,
        );
        if (!pairing) {
          throw new ConflictException(
            'Mentor is already paired with another trainee for this event',
          );
        }
      });
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(
          'Mentor is already paired with another trainee for this event',
        );
      }
      throw error;
    }

    return this.getParticipantsByEvent(eventId, actor);
  }

  public async deletePairingWithAttendees(
    eventId: string,
    pairingId: string,
    actor: AuthenticatedUser,
  ) {
    const event = await this.getEventOrThrow(eventId);
    this.assertAdmin(actor, event.branchId);

    await this.sequelize.transaction(async (transaction) => {
      const pairing = await this.attendeeRepository.findPairingById(
        eventId,
        pairingId,
        transaction,
      );

      if (!pairing) {
        throw new NotFoundException('Pairing not found');
      }

      await this.attendeeRepository.deletePairing(pairing.id, transaction);
    });

    return this.getParticipantsByEvent(eventId, actor);
  }

  public async getRecentAttendanceByBranch(branchId: string, days: number) {
    try {
      return await this.attendeeRepository.getRecentAttendanceByBranch(
        branchId,
        days,
      );
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to fetch attendance stats',
      );
    }
  }

  public async getMonthlyStatsByBranch(branchId: string, months: number) {
    try {
      return await this.attendeeRepository.getMonthlyStatsByBranch(
        branchId,
        months,
      );
    } catch (error) {
      throw new InternalServerErrorException('Failed to fetch monthly stats');
    }
  }

  private getActorId(actor: AuthenticatedUser) {
    const userId = actor.userId ?? actor.sub;
    if (!userId) {
      throw new ForbiddenException('Missing authenticated user');
    }
    return userId;
  }

  private assertVolunteer(actor: AuthenticatedUser) {
    if (!this.actorHasRole(actor, AUTH_ROLES.VOLUNTEER.id)) {
      throw new ForbiddenException('Volunteer role is required');
    }
  }

  private assertTrainee(actor: AuthenticatedUser) {
    if (!this.actorHasRole(actor, AUTH_ROLES.TRAINEE.id)) {
      throw new ForbiddenException('Trainee role is required');
    }
  }

  private assertAdmin(actor: AuthenticatedUser, branchId: string) {
    const isSuperAdmin = this.actorHasRole(actor, AUTH_ROLES.SUPER_ADMIN.id);
    const isBranchAdmin = actor.roles?.some(
      (role) =>
        role.roleId === AUTH_ROLES.BRANCH_ADMIN.id &&
        (role.branchId === branchId || role.resourceId === branchId),
    );

    if (!isSuperAdmin && !isBranchAdmin) {
      throw new ForbiddenException('Admin role is required for this branch');
    }
  }

  private getAdminBranchFilter(actor: AuthenticatedUser) {
    if (this.actorHasRole(actor, AUTH_ROLES.SUPER_ADMIN.id)) {
      return undefined;
    }

    const branchIds =
      actor.roles
        ?.filter((role) => role.roleId === AUTH_ROLES.BRANCH_ADMIN.id)
        .map((role) => role.branchId ?? role.resourceId)
        .filter((branchId): branchId is string => !!branchId) ?? [];

    if (branchIds.length === 0) {
      throw new ForbiddenException('Admin role is required');
    }

    return Array.from(new Set(branchIds));
  }

  private assertBranchAccess(actor: AuthenticatedUser, branchId: string) {
    if (this.actorHasRole(actor, AUTH_ROLES.SUPER_ADMIN.id)) {
      return;
    }

    const hasBranch = actor.roles?.some(
      (role) => role.branchId === branchId || role.resourceId === branchId,
    );
    if (!hasBranch) {
      throw new ForbiddenException('Branch access denied');
    }
  }

  private actorHasRole(actor: AuthenticatedUser, roleId: number) {
    return actor.roles?.some((role) => role.roleId === roleId) ?? false;
  }

  private async getEventOrThrow(eventId: string) {
    const event = await Event.findByPk(eventId);
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  private async assertUsersBelongToBranch(userIds: string[], branchId: string) {
    const users = await User.findAll({
      where: { id: userIds, isActive: true },
      include: [UserRole],
    });

    if (users.length !== userIds.length) {
      throw new NotFoundException('User not found');
    }

    const invalid = users.some(
      (user) => !this.userBelongsToBranch(user, branchId),
    );
    if (invalid) {
      throw new ForbiddenException('Cross-branch pairing is not allowed');
    }
  }

  private async assertUserRole(userId: string, roleId: number) {
    const role = await UserRole.findOne({ where: { userId, roleId } });
    if (!role) {
      throw new BadRequestException('User role does not match pairing slot');
    }
  }

  private userBelongsToBranch(user: User, branchId: string) {
    if (user.branchId === branchId) {
      return true;
    }
    return (
      user.userRoles?.some((role) => String(role.resourceId) === branchId) ??
      false
    );
  }

  private userHasRole(user: User | undefined, roleId: number) {
    return user?.userRoles?.some((role) => role.roleId === roleId) ?? false;
  }

  private toSafeAttendee(attendee: any) {
    return typeof attendee?.toJSON === 'function'
      ? attendee.toJSON()
      : attendee;
  }
}
