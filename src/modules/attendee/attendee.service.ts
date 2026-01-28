import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import AttendeeRepository from './attendee.repository';

@Injectable()
export default class AttendeeService {
  constructor(private readonly attendeeRepository: AttendeeRepository) {}

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

  public async getAllAttendeesByEvent(eventId: string) {
    try {
      return await this.attendeeRepository.getAttendeesByEvent(eventId);
    } catch (error) {
      console.log(error);
    }
  }
}
