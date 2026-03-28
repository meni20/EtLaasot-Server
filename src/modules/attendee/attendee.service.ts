import { Injectable, InternalServerErrorException } from '@nestjs/common';
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

  public async joinEvent(userId: string, eventId: string, rsvpStatus: string) {
    try {
      return await this.attendeeRepository.createAndConfirm(
        userId,
        eventId,
        rsvpStatus,
      );
    } catch (error) {
      throw new InternalServerErrorException('Failed to join event');
    }
  }

  public async getAllAttendeesByEvent(eventId: string) {
    try {
      return await this.attendeeRepository.getAttendeesByEvent(eventId);
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to fetch attendees by event',
      );
    }
  }

  public async updateRsvp(attendeeId: string, rsvpStatus: string) {
    try {
      return await this.attendeeRepository.updateRsvp(attendeeId, rsvpStatus);
    } catch (error) {
      throw new InternalServerErrorException('Failed to update RSVP');
    }
  }

  public async checkIn(attendeeId: string, checkedInBy: string) {
    try {
      return await this.attendeeRepository.checkIn(attendeeId, checkedInBy);
    } catch (error) {
      throw new InternalServerErrorException('Failed to check in attendee');
    }
  }

  public async deleteAttendee(attendeeId: string) {
    try {
      return await this.attendeeRepository.deleteAttendee(attendeeId);
    } catch (error) {
      throw new InternalServerErrorException('Failed to delete attendee');
    }
  }

  public async getRecentAttendanceByBranch(branchId: string, days: number) {
    try {
      return await this.attendeeRepository.getRecentAttendanceByBranch(
        branchId,
        days,
      );
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to fetch attendance stats',
      );
    }
  }

  public async getMonthlyStatsByBranch(branchId: string, months: number) {
    try {
      return await this.attendeeRepository.getMonthlyStatsByBranch(
        branchId,
        months,
      );
    } catch (error) {
      throw new InternalServerErrorException('Failed to fetch monthly stats');
    }
  }
}
