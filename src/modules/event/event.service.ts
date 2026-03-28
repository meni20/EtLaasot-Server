import { Injectable, InternalServerErrorException } from '@nestjs/common';
import EventRepository from './event.repository';
import { IEvent } from './interfaces/event.interface';
import AttendeeService from '../attendee/attendee.service';

@Injectable()
export default class EventService {
  constructor(
    private readonly eventRepository: EventRepository,
    private readonly attendeeService: AttendeeService,
  ) { }

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

  public async findAllEvents(branchId?: string) {
    try {
      return await this.eventRepository.findAll(branchId);
    } catch (error) {
      throw new InternalServerErrorException('Failed to fetch events');
    }
  }

  public async addAttendee(userId: string, eventId: string) {
    try {
      return await this.attendeeService.addAttendee(userId, eventId);
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to add attendee to event',
      );
    }
  }

  public async getAllAttendeesByEvent(eventId: string) {
    try {
      return await this.attendeeService.getAllAttendeesByEvent(eventId);
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to fetch attendees by event',
      );
    }
  }

  public async getUpcomingByBranch(branchId: string, limit: number) {
    try {
      return await this.eventRepository.getUpcomingByBranch(branchId, limit);
    } catch (error) {
      throw new InternalServerErrorException('Failed to fetch upcoming events');
    }
  }

  public async getEventsByBranchAndDateRange(
    branchId: string,
    startDate: Date,
    endDate: Date,
  ) {
    try {
      return await this.eventRepository.getEventsByBranchAndDateRange(
        branchId,
        startDate,
        endDate,
      );
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to fetch events by date range',
      );
    }
  }
}
