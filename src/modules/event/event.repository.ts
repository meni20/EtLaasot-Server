import { Transaction } from 'sequelize';
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

  public async findAll(): Promise<Event[]> {
    return Event.findAll({
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
    });
  }
}
