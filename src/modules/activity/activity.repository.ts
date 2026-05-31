import { Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import VolunteerActivity from './entities/activity.entity';
import { IVolunteerActivity } from './interfaces/activity.interface';
import User from '../user/entities/user.entity';
import Event from '../event/entities/event.entity';
import Branch from '../branch/entities/branch.entity';
import { VolunteerActivityStatus } from './activity.constants';

interface ActivityAdminFilterOptions {
  branchIds?: string[];
  volunteerId?: string;
  traineeId?: string;
  eventId?: string;
  status?: VolunteerActivityStatus;
  startDate?: Date;
  endDate?: Date;
}

@Injectable()
export default class ActivityRepository {
  private readonly relations = [
    {
      model: User,
      as: 'volunteer',
      attributes: ['id', 'name', 'branchId'],
    },
    {
      model: User,
      as: 'trainee',
      attributes: ['id', 'name', 'branchId'],
    },
    {
      model: Event,
      attributes: ['id', 'name', 'eventType', 'branchId'],
    },
    {
      model: Branch,
      attributes: ['id', 'name'],
      required: false,
    },
  ];

  public async create(data: IVolunteerActivity) {
    return VolunteerActivity.create(data);
  }

  public async findById(id: string) {
    return VolunteerActivity.findByPk(id, {
      include: this.relations,
    });
  }

  public async findActiveByVolunteer(volunteerId: string) {
    return VolunteerActivity.findOne({
      where: {
        volunteerId,
        status: VolunteerActivityStatus.ACTIVE,
      },
      include: this.relations,
      order: [['startTime', 'DESC']],
      limit: 2000,
    });
  }

  public async findHistoryByVolunteer(volunteerId: string, limit = 20) {
    return VolunteerActivity.findAll({
      where: { volunteerId },
      include: this.relations,
      order: [['startTime', 'DESC'], ['createdAt', 'DESC']],
      limit,
    });
  }

  public async findCompletedByVolunteer(volunteerId: string) {
    return VolunteerActivity.findAll({
      where: {
        volunteerId,
        status: VolunteerActivityStatus.COMPLETED,
        endTime: { [Op.not]: null },
      },
      order: [['startTime', 'DESC']],
    });
  }

  public async findAdminActivities(filters: ActivityAdminFilterOptions) {
    const where: Record<string, unknown> = {};

    if (filters.branchIds?.length === 1) {
      where.branchId = filters.branchIds[0];
    } else if (filters.branchIds?.length) {
      where.branchId = { [Op.in]: filters.branchIds };
    }

    if (filters.volunteerId) {
      where.volunteerId = filters.volunteerId;
    }

    if (filters.traineeId) {
      where.traineeId = filters.traineeId;
    }

    if (filters.eventId) {
      where.eventId = filters.eventId;
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.startDate || filters.endDate) {
      where.startTime = {
        ...(filters.startDate ? { [Op.gte]: filters.startDate } : {}),
        ...(filters.endDate ? { [Op.lte]: filters.endDate } : {}),
      };
    }

    return VolunteerActivity.findAll({
      where,
      include: this.relations,
      order: [['startTime', 'DESC'], ['createdAt', 'DESC']],
      limit: 1000,
    });
  }

  public async findAttendanceByEvent(eventId: string) {
    return VolunteerActivity.findAll({
      where: {
        eventId,
        status: {
          [Op.in]: [
            VolunteerActivityStatus.ACTIVE,
            VolunteerActivityStatus.COMPLETED,
          ],
        },
      },
      include: [
        {
          model: User,
          as: 'volunteer',
          attributes: ['id', 'name', 'branchId'],
        },
      ],
      order: [['startTime', 'DESC'], ['createdAt', 'DESC']],
      limit: 1000,
    });
  }

  public async removeVolunteerAttendanceForEvent(
    eventId: string,
    volunteerId: string,
  ) {
    return VolunteerActivity.destroy({
      where: { eventId, volunteerId },
    });
  }
}
