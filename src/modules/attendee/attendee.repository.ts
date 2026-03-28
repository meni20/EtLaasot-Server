import { Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import Attendee from './entities/attendee.entity';
import User from '../user/entities/user.entity';
import Event from '../event/entities/event.entity';

@Injectable()
export default class AttendeeRepository {
  public async createAttendee(userId: string, eventId: string) {
    const existing = await Attendee.findOne({ where: { userId, eventId } });
    if (existing) {
      return existing;
    }
    return Attendee.create({ userId, eventId });
  }

  public async createAndConfirm(
    userId: string,
    eventId: string,
    rsvpStatus: string,
  ) {
    const existing = await Attendee.findOne({ where: { userId, eventId } });
    if (existing) {
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
      include: [{ model: User, attributes: ['id', 'name', 'email'] }],
    });
  }

  public async findById(attendeeId: string) {
    return Attendee.findByPk(attendeeId, {
      include: [{ model: User, attributes: ['id', 'name', 'email'] }],
    });
  }

  public async updateRsvp(attendeeId: string, rsvpStatus: string) {
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

  public async deleteAttendee(attendeeId: string) {
    return Attendee.destroy({ where: { id: attendeeId } });
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
    });

    const total = attendees.length;
    const checkedInCount = attendees.filter((a) => a.checkedIn).length;
    const rate = total > 0 ? Math.round((checkedInCount / total) * 100) : 0;

    return { total, checkedInCount, rate };
  }

  public async getMonthlyStatsByBranch(branchId: string, months: number) {
    const stats: {
      month: string;
      attendanceRate: number;
      totalEvents: number;
      totalAttendees: number;
    }[] = [];
    const now = new Date();

    for (let i = months - 1; i >= 0; i--) {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const endOfMonth = new Date(
        now.getFullYear(),
        now.getMonth() - i + 1,
        0,
        23,
        59,
        59,
      );

      const attendees = await Attendee.findAll({
        include: [
          {
            model: Event,
            where: {
              branchId,
              startDate: { [Op.gte]: startOfMonth, [Op.lte]: endOfMonth },
            },
            attributes: ['id'],
            required: true,
          },
        ],
      });

      const total = attendees.length;
      const checkedIn = attendees.filter((a) => a.checkedIn).length;
      const eventIds = new Set(attendees.map((a) => a.eventId));

      stats.push({
        month: startOfMonth.toISOString().slice(0, 7),
        attendanceRate: total > 0 ? Math.round((checkedIn / total) * 100) : 0,
        totalEvents: eventIds.size,
        totalAttendees: total,
      });
    }

    return stats;
  }
}
