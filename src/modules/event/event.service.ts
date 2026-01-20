import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import EventRepository from './event.repository';
import { IEvent } from './interfaces/event.interface';
import AttendeeService from '../attendee/attendee.service';

@Injectable()
export default class EventService {
  constructor(
    private readonly eventRepository: EventRepository,
    private readonly attendeeService: AttendeeService,
  ) {}

  public async createEvent(eventData: IEvent) {
    try {
      const payload = {
        ...eventData,
        startDate: new Date(eventData.startDate),
        endDate: new Date(eventData.endDate),
      };
      const event = await this.eventRepository.create(payload);
      return event;
    } catch (error) {
      throw new InternalServerErrorException('Failed to create event');
    }
  }

  public async findAllEvents() {
    try {
      return await this.eventRepository.findAll();
    } catch (error) {
      console.log(error);

      throw new InternalServerErrorException('Failed to fetch events');
    }
  }

  public addAttendee(userId: string, eventId: string) {
    try {
      return this.attendeeService.addAttendee(userId, eventId);
    } catch (error) {
      throw new InternalServerErrorException('Failed to add attendee');
    }
  }
}
