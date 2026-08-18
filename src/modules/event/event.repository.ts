import { Op, Transaction } from 'sequelize';
import { Injectable } from '@nestjs/common';
import Event from './entities/event.entity';
import User from '../user/entities/user.entity';
import { IEvent } from './interfaces/event.interface';
import Attendee from '../attendee/entities/attendee.entity';
import CalendarMonthBackground from './entities/calendar-month-background.entity';

@Injectable()
export default class EventRepository {
  public async create(eventDate: IEvent, transaction?: Transaction) {
    return await Event.create(eventDate, { transaction });
  }

  public async updateEvent(id: string, eventData: Partial<IEvent>) {
    const event = await Event.findByPk(id);

    if (!event) {
      return null;
    }

    await event.update(eventData);
    return event;
  }

  public async updateImagePath(id: string, imagePath: string | null) {
    const event = await Event.findByPk(id);

    if (!event) {
      return null;
    }

    await event.update({ imagePath });
    return event;
  }

  public async updateAiSummary(
    id: string,
    aiSummary: string,
    aiSummaryGeneratedAt: Date,
  ) {
    const event = await Event.findByPk(id);

    if (!event) {
      return null;
    }

    await event.update({ aiSummary, aiSummaryGeneratedAt });
    return event;
  }

  public async findAll(branchId?: string): Promise<Event[]> {
    const where: any = {};
    if (branchId) where.branchId = branchId;

    return Event.findAll({
      where,
      attributes: { exclude: ['aiSummary', 'aiSummaryGeneratedAt'] },
      include: [
        {
          model: Attendee,
          // Event lists only use attendee count and membership. Full attendee
          // profiles are loaded by the dedicated event-attendees endpoint.
          attributes: ['userId'],
        },
      ],
      order: [['start_date', 'DESC']],
      limit: 500,
    });
  }

  public async findById(id: string): Promise<Event | null> {
    return Event.findByPk(id, {
      include: [
        {
          model: Attendee,
          include: [
            {
              model: User,
              attributes: ['id', 'name', 'email', 'phoneNumber'],
            },
          ],
        },
      ],
    });
  }

  public async getUpcomingByBranch(branchId: string, limit: number) {
    const now = new Date();

    return Event.findAll({
      where: {
        branchId,
        startDate: { [Op.gte]: now },
      },
      order: [['start_date', 'ASC']],
      limit,
      include: [{ model: Attendee, attributes: ['userId'] }],
    });
  }

  public async getEventsByBranchAndDateRange(
    branchId: string,
    startDate: Date,
    endDate: Date,
  ) {
    return Event.findAll({
      where: {
        branchId,
        startDate: { [Op.between]: [startDate, endDate] },
      },
      include: [
        {
          model: Attendee,
          include: [{ model: User, attributes: { exclude: ['allergies'] } }],
        },
      ],
      order: [['start_date', 'ASC']],
      limit: 1000,
    });
  }

  public async findCalendarBackground(branchId: string, monthKey: string) {
    return CalendarMonthBackground.findOne({
      where: { branchId, monthKey },
    });
  }

  public async upsertCalendarBackground(data: {
    branchId: string;
    monthKey: string;
    imagePath: string;
    uploadedBy?: string | null;
  }) {
    const existing = await this.findCalendarBackground(
      data.branchId,
      data.monthKey,
    );

    if (existing) {
      await existing.update({
        imagePath: data.imagePath,
        uploadedBy: data.uploadedBy ?? null,
      });
      return existing;
    }

    return CalendarMonthBackground.create({
      branchId: data.branchId,
      monthKey: data.monthKey,
      imagePath: data.imagePath,
      uploadedBy: data.uploadedBy ?? null,
    });
  }

  public async deleteCalendarBackground(branchId: string, monthKey: string) {
    const existing = await this.findCalendarBackground(branchId, monthKey);
    if (!existing) return null;

    await existing.destroy();
    return existing;
  }
}
