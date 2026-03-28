import { Op, Transaction } from 'sequelize';
import { Injectable } from '@nestjs/common';
import Event from './entities/event.entity';
import { IEvent } from './interfaces/event.interface';
import Attendee from '../attendee/entities/attendee.entity';
import User from '../user/entities/user.entity';

@Injectable()
export default class EventRepository {
  public async create(eventDate: IEvent, transaction?: Transaction) {
    return await Event.create(eventDate, { transaction });
  }

  public async findAll(branchId?: string): Promise<Event[]> {
    const where: any = {};
    if (branchId) where.branchId = branchId;

    return Event.findAll({
      where,
      include: [
        {
          model: Attendee,
          include: [
            {
              model: User,
              attributes: [
                'id',
                'name',
                'email',
                'phoneNumber',
                'address',
                'age',
              ],
            },
          ],
        },
      ],
      order: [['start_date', 'DESC']],
    });
  }

  public async findById(id: string): Promise<Event | null> {
    return Event.findByPk(id, {
      include: [
        {
          model: Attendee,
          include: [
            { model: User, attributes: ['id', 'name', 'email', 'phoneNumber'] },
          ],
        },
      ],
    });
  }

  public async getUpcomingByBranch(branchId: string, limit: number) {
    return Event.findAll({
      where: { branchId },
      order: [['start_date', 'DESC']],
      limit,
      include: [{ model: Attendee }],
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
      include: [{ model: Attendee, include: [{ model: User }] }],
      order: [['start_date', 'ASC']],
    });
  }
}
