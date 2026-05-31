import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import AttendeeRepository from './attendee.repository';
import { AUTH_ROLES } from 'src/constants/auth.constants';
import Event from '../event/entities/event.entity';
import MentorAssignment from '../mentor-assignment/entities/mentor-assignment.entity';
import User from '../user/entities/user.entity';
import UserRole from '../user-role/enitites/user-role.entity';
import {
  AttendanceIntent,
  AttendeeRsvpStatus,
} from './attendee.constants';

type AuthenticatedUser = {
  userId?: string;
  sub?: string;
  roles?: { roleId: number; branchId?: string; resourceId?: string }[];
  activeBranch?: string;
};

@Injectable()
export default class AttendeeService {
  constructor(
    private readonly attendeeRepository: AttendeeRepository,
    private readonly sequelize: Sequelize,
  ) {}

  public async addAttendee(userId: string, eventId: string) {
    try {
      const attendee = await this.attendeeRepository.createAttendee(
        userId,
        eventId,
      );
      return attendee;
    } catch (error) {
      throw new InternalServerErrorException('Failed to create attendee');
    }
  }

  public async joinEvent(
    userId: string,
    eventId: string,
    rsvpStatus: AttendeeRsvpStatus,
  ) {
    try {
      return await this.attendeeRepository.createAndConfirm(
        userId,
        eventId,
        rsvpStatus,
      );
    } catch (error) {
      throw new InternalServerErrorException('Failed to join event');
    }
  }

  public async getAllAttendeesByEvent(eventId: string) {
    try {
      return await this.attendeeRepository.getAttendeesByEvent(eventId);
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to fetch attendees by event',
      );
    }
  }

  public async updateRsvp(
    attendeeId: string,
    rsvpStatus: AttendeeRsvpStatus,
  ) {
    try {
      return await this.attendeeRepository.updateRsvp(attendeeId, rsvpStatus);
    } catch (error) {
      throw new InternalServerErrorException('Failed to update RSVP');
    }
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
    const volunteerId = this.getActorId(actor);
    const event = await this.getEventOrThrow(eventId);
    this.assertBranchAccess(actor, event.branchId);
    this.assertVolunteer(actor);

    const assignment = await MentorAssignment.findOne({
      where: {
        mentorId: volunteerId,
        branchId: event.branchId,
        isActive: true,
      },
      order: [['startDate', 'DESC']],
    });
    const traineeId = assignment?.traineeId;

    if (
      (intent === AttendanceIntent.BOTH ||
        intent === AttendanceIntent.TRAINEE_ONLY) &&
      !traineeId
    ) {
      throw new BadRequestException('No active trainee assignment found');
    }

    if (traineeId) {
      await this.assertUsersBelongToBranch([volunteerId, traineeId], event.branchId);
    } else {
      await this.assertUsersBelongToBranch([volunteerId], event.branchId);
    }

    await this.sequelize.transaction(async (transaction) => {
      if (intent === AttendanceIntent.BOTH) {
        await this.attendeeRepository.ensureAttendee(
          volunteerId,
          eventId,
          transaction,
        );
        await this.attendeeRepository.ensureAttendee(
          traineeId!,
          eventId,
          transaction,
        );
        await this.attendeeRepository.createPairing(
          eventId,
          volunteerId,
          traineeId!,
          event.branchId,
          transaction,
        );
      }

      if (intent === AttendanceIntent.VOLUNTEER_ONLY) {
        await this.attendeeRepository.ensureAttendee(
          volunteerId,
          eventId,
          transaction,
        );
        await this.attendeeRepository.removePairingsForUsers(
          eventId,
          [volunteerId],
          transaction,
        );
        if (traineeId) {
          await this.attendeeRepository.removeAttendee(
            traineeId,
            eventId,
            transaction,
          );
        }
      }

      if (intent === AttendanceIntent.TRAINEE_ONLY) {
        await this.attendeeRepository.ensureAttendee(
          traineeId!,
          eventId,
          transaction,
        );
        await this.attendeeRepository.removePairingsForUsers(
          eventId,
          [traineeId!],
          transaction,
        );
        await this.attendeeRepository.removeAttendee(
          volunteerId,
          eventId,
          transaction,
        );
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

    });

    return this.getParticipantsByEvent(eventId, actor);
  }

  public async getParticipantsByEvent(
    eventId: string,
    actor?: AuthenticatedUser,
  ) {
    const event = await this.getEventOrThrow(eventId);
    if (actor) {
      this.assertBranchAccess(actor, event.branchId);
    }

    const { attendees, pairings } =
      await this.attendeeRepository.getStructuredParticipants(eventId);
    const pairedUserIds = new Set<string>();
    const paired = pairings.map((pairing) => {
      pairedUserIds.add(pairing.mentorId);
      pairedUserIds.add(pairing.traineeId);

      return {
        id: pairing.id,
        eventId: pairing.eventId,
        mentorId: pairing.mentorId,
        traineeId: pairing.traineeId,
        mentor: pairing.mentor,
        trainee: pairing.trainee,
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

    return { paired, unpairedMentors, unpairedTrainees };
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

    await this.sequelize.transaction(async (transaction) => {
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

      await this.attendeeRepository.createPairing(
        eventId,
        mentorId,
        traineeId,
        event.branchId,
        transaction,
      );

    });

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
      where: { id: userIds },
      include: [UserRole],
    });

    if (users.length !== userIds.length) {
      throw new NotFoundException('User not found');
    }

    const invalid = users.some((user) => !this.userBelongsToBranch(user, branchId));
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
      user.userRoles?.some(
        (role) => String(role.resourceId) === branchId,
      ) ?? false
    );
  }

  private userHasRole(user: User | undefined, roleId: number) {
    return user?.userRoles?.some((role) => role.roleId === roleId) ?? false;
  }
}
