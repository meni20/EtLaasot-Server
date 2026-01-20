import { Injectable } from '@nestjs/common';
import Attendee from './entities/attendee.entity';

@Injectable()
export default class AttendeeRepository {
  public async createAttendee(userId: string, eventId: string) {
    return Attendee.create({ userId, eventId });
  }
}
