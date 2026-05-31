import { Injectable } from '@nestjs/common';
import { Op, Transaction } from 'sequelize';
import Attendee from './entities/attendee.entity';
import EventPairing from './entities/event-pairing.entity';
import User from '../user/entities/user.entity';
import Event from '../event/entities/event.entity';
import UserRole from '../user-role/enitites/user-role.entity';
import { AttendeeRsvpStatus } from './attendee.constants';

@Injectable()
export default class AttendeeRepository {
  public async createAttendee(
    userId: string,
    eventId: string,
    transaction?: Transaction,
  ) {
    const existing = await Attendee.findOne({
      where: { userId, eventId },
      paranoid: false,
      transaction,
    });
    if (existing) {
      if ((existing as any).deletedAt) {
        await existing.restore({ transaction });
      }

      return existing.reload({ transaction });
    }

    return Attendee.create({ userId, eventId }, { transaction });
  }

  public async createAndConfirm(
    userId: string,
    eventId: string,
    rsvpStatus: AttendeeRsvpStatus,
  ) {
    const existing = await Attendee.findOne({
      where: { userId, eventId },
      paranoid: false,
    });
    if (existing) {
      if ((existing as any).deletedAt) {
        await existing.restore();
      }

      await existing.update({ rsvpStatus, rsvpDate: new Date() });
      return existing.reload({
        include: [{ model: User, attributes: ['id', 'name', 'email'] }],
      });
    }
    const attendee = await Attendee.create({
      userId,
      eventId,
      rsvpStatus,
      rsvpDate: new Date(),
    });
    return attendee.reload({
      include: [{ model: User, attributes: ['id', 'name', 'email'] }],
    });
  }

  public async getAttendeesByEvent(eventId: string) {
    return Attendee.findAll({
      where: { eventId },
      include: [
        {
          model: User,
          attributes: ['id', 'name', 'email', 'phoneNumber', 'branchId'],
          include: [{ model: UserRole }],
        },
      ],
      limit: 1000,
    });
  }

  public async findById(attendeeId: string) {
    return Attendee.findByPk(attendeeId, {
      include: [{ model: User, attributes: ['id', 'name', 'email'] }],
    });
  }

  public async updateRsvp(
    attendeeId: string,
    rsvpStatus: AttendeeRsvpStatus,
  ) {
    return Attendee.update(
      { rsvpStatus, rsvpDate: new Date() },
      { where: { id: attendeeId } },
    );
  }

  public async checkIn(attendeeId: string, checkedInBy: string) {
    return Attendee.update(
      { checkedIn: true, checkedInAt: new Date(), checkedInBy },
      { where: { id: attendeeId } },
    );
  }

  public async deleteAttendee(attendeeId: string, transaction?: Transaction) {
    return Attendee.destroy({ where: { id: attendeeId }, transaction });
  }

  public async findAttendeeByUserEvent(
    userId: string,
    eventId: string,
    transaction?: Transaction,
  ) {
    return Attendee.findOne({ where: { userId, eventId }, transaction });
  }

  public async ensureAttendee(
    userId: string,
    eventId: string,
    transaction: Transaction,
  ) {
    return this.createAttendee(userId, eventId, transaction);
  }

  public async removeAttendee(
    userId: string,
    eventId: string,
    transaction: Transaction,
  ) {
    return Attendee.destroy({ where: { userId, eventId }, transaction });
  }

  public async removePairingsForUsers(
    eventId: string,
    userIds: string[],
    transaction: Transaction,
  ) {
    if (userIds.length === 0) return 0;

    return EventPairing.destroy({
      where: {
        eventId,
        [Op.or]: [
          { mentorId: { [Op.in]: userIds } },
          { traineeId: { [Op.in]: userIds } },
        ],
      },
      transaction,
    });
  }

  public async createPairing(
    eventId: string,
    mentorId: string,
    traineeId: string,
    branchId: string,
    transaction: Transaction,
  ) {
    await this.removePairingsForUsers(eventId, [mentorId, traineeId], transaction);
    return EventPairing.create(
      { eventId, mentorId, traineeId, branchId },
      { transaction },
    );
  }

  public async findPairingById(
    eventId: string,
    pairingId: string,
    transaction?: Transaction,
  ) {
    return EventPairing.findOne({
      where: { id: pairingId, eventId },
      transaction,
    });
  }

  public async deletePairing(pairingId: string, transaction: Transaction) {
    return EventPairing.destroy({ where: { id: pairingId }, transaction });
  }

  public async getStructuredParticipants(eventId: string) {
    const [attendees, pairings] = await Promise.all([
      Attendee.findAll({
        where: { eventId },
        include: [
          {
            model: User,
            attributes: ['id', 'name', 'email', 'phoneNumber', 'branchId'],
            include: [{ model: UserRole }],
          },
        ],
        order: [['createdAt', 'ASC']],
        limit: 1000,
      }),
      EventPairing.findAll({
        where: { eventId },
        include: [
          {
            model: User,
            as: 'mentor',
            attributes: ['id', 'name', 'email', 'phoneNumber', 'branchId'],
          },
          {
            model: User,
            as: 'trainee',
            attributes: ['id', 'name', 'email', 'phoneNumber', 'branchId'],
          },
        ],
        order: [['createdAt', 'ASC']],
        limit: 1000,
      }),
    ]);

    return { attendees, pairings };
  }

  public async getRecentAttendanceByBranch(branchId: string, days: number) {
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    const attendees = await Attendee.findAll({
      include: [
        {
          model: Event,
          where: { branchId },
          attributes: ['id', 'name', 'startDate'],
          required: true,
        },
      ],
      where: {
        createdAt: { [Op.gte]: sinceDate },
      },
      limit: 5000,
    });

    const total = attendees.length;
    const checkedInCount = attendees.filter((a) => a.checkedIn).length;
    const rate = total > 0 ? Math.round((checkedInCount / total) * 100) : 0;

    return { total, checkedInCount, rate };
  }

  public async getMonthlyStatsByBranch(branchId: string, months: number) {
    const now = new Date();
    const safeMonths = Math.min(Math.max(months, 1), 24);
    const monthStarts = Array.from({ length: safeMonths }, (_, index) => {
      const monthsBack = safeMonths - 1 - index;
      return new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
    });
    const firstMonthStart = monthStarts[0];
    const lastMonthEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
    );

    const statsByMonth = new Map(
      monthStarts.map((startOfMonth) => [
        startOfMonth.toISOString().slice(0, 7),
        {
          checkedIn: 0,
          eventIds: new Set<string>(),
          totalAttendees: 0,
        },
      ]),
    );

    const attendees = await Attendee.findAll({
      include: [
        {
          model: Event,
          where: {
            branchId,
            startDate: { [Op.gte]: firstMonthStart, [Op.lte]: lastMonthEnd },
          },
          attributes: ['id', 'startDate'],
          required: true,
        },
      ],
      limit: 5000,
    });

    attendees.forEach((attendee) => {
      const month = attendee.event?.startDate?.toISOString().slice(0, 7);
      if (!month) {
        return;
      }

      const bucket = statsByMonth.get(month);
      if (!bucket) {
        return;
      }

      bucket.totalAttendees += 1;
      bucket.eventIds.add(attendee.eventId);
      if (attendee.checkedIn) {
        bucket.checkedIn += 1;
      }
    });

    return monthStarts.map((startOfMonth) => {
      const month = startOfMonth.toISOString().slice(0, 7);
      const bucket = statsByMonth.get(month)!;

      return {
        month,
        attendanceRate:
          bucket.totalAttendees > 0
            ? Math.round((bucket.checkedIn / bucket.totalAttendees) * 100)
            : 0,
        totalEvents: bucket.eventIds.size,
        totalAttendees: bucket.totalAttendees,
      };
    });
  }
}
