import {
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import EventRepository from './event.repository';
import { IEvent } from './interfaces/event.interface';
import AttendeeService from '../attendee/attendee.service';
import Event from './entities/event.entity';
import { SupabaseStorageService } from '../storage/supabase-storage.service';

type EventInput = Omit<IEvent, 'startDate' | 'endDate' | 'imageUrl'> & {
  startDate: string | Date;
  endDate: string | Date;
};

@Injectable()
export default class EventService {
  private readonly logger = new Logger(EventService.name);

  constructor(
    private readonly eventRepository: EventRepository,
    private readonly attendeeService: AttendeeService,
    private readonly supabaseStorageService: SupabaseStorageService,
  ) {}

  public async createEvent(eventData: EventInput) {
    try {
      const payload = {
        ...eventData,
        startDate: new Date(eventData.startDate),
        endDate: new Date(eventData.endDate),
      };
      const event = await this.eventRepository.create(payload);
      return this.serializeEvent(event);
    } catch (error) {
      throw new InternalServerErrorException('Failed to create event');
    }
  }

  public async updateEvent(id: string, eventData: EventInput) {
    try {
      const payload = {
        ...eventData,
        startDate: new Date(eventData.startDate),
        endDate: new Date(eventData.endDate),
      };

      const event = await this.eventRepository.updateEvent(id, payload);

      if (!event) {
        throw new NotFoundException('Event not found');
      }

      return this.serializeEvent(event);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to update event');
    }
  }

  public async findAllEvents(branchId?: string) {
    try {
      const events = await this.eventRepository.findAll(branchId);
      return events.map((event) => this.serializeEvent(event));
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
      const events = await this.eventRepository.getUpcomingByBranch(
        branchId,
        limit,
      );
      return events.map((event) => this.serializeEvent(event));
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
      const events = await this.eventRepository.getEventsByBranchAndDateRange(
        branchId,
        startDate,
        endDate,
      );
      return events.map((event) => this.serializeEvent(event));
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to fetch events by date range',
      );
    }
  }

  public async findById(id: string) {
    try {
      const event = await this.eventRepository.findById(id);
      return event ? this.serializeEvent(event) : null;
    } catch (error) {
      throw new InternalServerErrorException('Failed to fetch event');
    }
  }

  public async getParticipantsByEvent(eventId: string, actor: any) {
    return await this.attendeeService.getParticipantsByEvent(eventId, actor);
  }

  public async createManualPairing(
    eventId: string,
    mentorId: string,
    traineeId: string,
    actor: any,
  ) {
    return await this.attendeeService.createManualPairing(
      eventId,
      mentorId,
      traineeId,
      actor,
    );
  }

  public async deletePairingWithAttendees(
    eventId: string,
    pairingId: string,
    actor: any,
  ) {
    return await this.attendeeService.deletePairingWithAttendees(
      eventId,
      pairingId,
      actor,
    );
  }

  public async uploadEventImage(eventId: string, file: Express.Multer.File) {
    const existingEvent = await this.eventRepository.findById(eventId);

    if (!existingEvent) {
      throw new NotFoundException('Event not found');
    }

    const previousImagePath = existingEvent.imagePath;
    const imagePath = await this.supabaseStorageService.uploadEventImage(
      eventId,
      file,
    );

    let event: Event | null;

    try {
      event = await this.eventRepository.updateImagePath(
        eventId,
        imagePath,
      );

      if (!event) {
        throw new NotFoundException('Event not found');
      }
    } catch (error) {
      await this.deleteEventImageBestEffort(
        imagePath,
        'newly uploaded event image after DB update failure',
        eventId,
      );
      throw error;
    }

    await this.deleteEventImageBestEffort(
      previousImagePath,
      'previous event image after replacement',
      eventId,
    );

    return this.serializeEvent(event);
  }

  public async removeEventImage(eventId: string) {
    const existingEvent = await this.eventRepository.findById(eventId);

    if (!existingEvent) {
      throw new NotFoundException('Event not found');
    }

    const previousImagePath = existingEvent.imagePath;
    const event = await this.eventRepository.updateImagePath(eventId, null);

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    await this.deleteEventImageBestEffort(
      previousImagePath,
      'removed event image',
      eventId,
    );

    return this.serializeEvent(event);
  }

  private serializeEvent(event: Event): IEvent {
    const plainEvent = event.toJSON() as IEvent;
    return {
      ...plainEvent,
      imageUrl: this.supabaseStorageService.getPublicUrl(plainEvent.imagePath),
    };
  }

  private async deleteEventImageBestEffort(
    imagePath: string | null | undefined,
    context: string,
    eventId: string,
  ): Promise<void> {
    if (!imagePath) {
      return;
    }

    try {
      await this.supabaseStorageService.deleteEventImage(imagePath);
    } catch (error) {
      this.logger.warn(
        `Failed to delete ${context} from storage for event ${eventId}: ${this.getErrorMessage(error)}`,
      );
    }
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }
}
