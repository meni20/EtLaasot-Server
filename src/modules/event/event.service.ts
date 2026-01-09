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
      const event = await this.eventRepository.create(eventData);
      return event;
    } catch (error) {
      throw new InternalServerErrorException('Failed to create event');
    }
  }

  public async findAllEvents() {
    try {
      const events = await this.eventRepository.findAll();
      return events;
    } catch (error) {
      throw new InternalServerErrorException('Failed to fetch events');
    }
  }

  public addAttendee(userId: string, eventId: string) {
    try {
      return this.attendeeService.createAttendee(userId, eventId);
    } catch (error) {
      throw new InternalServerErrorException('Failed to add attendee');
    }
  }
}
