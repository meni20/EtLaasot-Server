import { Injectable } from '@nestjs/common';
import Attendee from './entities/attendee.entity';
import User from '../user/entities/user.entity';

@Injectable()
export default class AttendeeRepository {
  public async createAttendee(userId: string, eventId: string) {
    return Attendee.create({ userId, eventId });
  }
  public async getAttendeesByEvent(eventId: string) {
    return Attendee.findAll({
      where: { eventId },
      include: [{ model: User, attributes: ["id","name", "email"] }],
    });
  }
}
