import {
  BadRequestException,
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
import ActivityRepository from '../activity/activity.repository';
import { AiService } from '../ai/ai.service';
import VolunteerActivity from '../activity/entities/activity.entity';
import { EmailService } from '../email/email.service';

type EventInput = Omit<IEvent, 'startDate' | 'endDate' | 'imageUrl'> & {
  startDate: string | Date;
  endDate: string | Date;
};

export interface EventAiInsightNote {
  id: string;
  volunteerName: string | null;
  traineeName: string | null;
  status: string;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventAiInsights {
  eventId: string;
  aiSummary: string | null;
  aiSummaryGeneratedAt: Date | null;
  isAiSummaryOutdated: boolean;
  notes: EventAiInsightNote[];
}

export interface CalendarMonthBackgroundResponse {
  id: string;
  branchId: string;
  monthKey: string;
  imagePath: string;
  imageUrl: string | null;
  uploadedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventAssignmentEmailDetail {
  userId: string;
  name: string;
  reason: string;
}

export interface EventAssignmentEmailResult {
  eventId: string;
  totalAttendingMentors: number;
  sentCount: number;
  skippedCount: number;
  failedCount: number;
  skipped: EventAssignmentEmailDetail[];
  failed: EventAssignmentEmailDetail[];
}

@Injectable()
export default class EventService {
  private readonly logger = new Logger(EventService.name);

  constructor(
    private readonly eventRepository: EventRepository,
    private readonly attendeeService: AttendeeService,
    private readonly supabaseStorageService: SupabaseStorageService,
    private readonly activityRepository: ActivityRepository,
    private readonly aiService: AiService,
    private readonly emailService: EmailService,
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
      throw new InternalServerErrorException('Failed to add attendee to event');
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
      event = await this.eventRepository.updateImagePath(eventId, imagePath);

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

  public async getCalendarMonthBackground(branchId: string, monthKey: string) {
    this.assertCalendarMonthKey(monthKey);
    const background = await this.eventRepository.findCalendarBackground(
      branchId,
      monthKey,
    );

    return background ? this.serializeCalendarBackground(background) : null;
  }

  public async uploadCalendarMonthBackground(
    branchId: string,
    monthKey: string,
    file: Express.Multer.File,
    uploadedBy?: string | null,
  ) {
    this.assertCalendarMonthKey(monthKey);
    const previousBackground =
      await this.eventRepository.findCalendarBackground(branchId, monthKey);
    const previousImagePath = previousBackground?.imagePath;
    const imagePath =
      await this.supabaseStorageService.uploadCalendarMonthBackground(
        branchId,
        monthKey,
        file,
      );

    try {
      const background = await this.eventRepository.upsertCalendarBackground({
        branchId,
        monthKey,
        imagePath,
        uploadedBy: uploadedBy ?? null,
      });

      await this.deleteEventImageBestEffort(
        previousImagePath,
        'previous calendar background after replacement',
        `${branchId}/${monthKey}`,
      );

      return this.serializeCalendarBackground(background);
    } catch (error) {
      await this.deleteEventImageBestEffort(
        imagePath,
        'newly uploaded calendar background after DB update failure',
        `${branchId}/${monthKey}`,
      );
      throw error;
    }
  }

  public async removeCalendarMonthBackground(branchId: string, monthKey: string) {
    this.assertCalendarMonthKey(monthKey);
    const background = await this.eventRepository.deleteCalendarBackground(
      branchId,
      monthKey,
    );

    if (!background) {
      return { ok: true };
    }

    await this.deleteEventImageBestEffort(
      background.imagePath,
      'removed calendar background',
      `${branchId}/${monthKey}`,
    );

    return { ok: true };
  }

  public async getEventAiInsights(eventId: string): Promise<EventAiInsights> {
    const event = await this.eventRepository.findById(eventId);

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const activities = await this.getRelevantCompletedActivities(eventId);
    const notes = activities.map((activity) => this.toAiInsightNote(activity));
    const generatedAt = event.aiSummaryGeneratedAt
      ? new Date(event.aiSummaryGeneratedAt)
      : null;
    const generatedAtTime = generatedAt?.getTime() ?? 0;

    const isAiSummaryOutdated =
      !event.aiSummary ||
      !generatedAt ||
      activities.some((activity) => {
        const updatedAt = new Date(activity.updatedAt).getTime();
        const createdAt = new Date(activity.createdAt).getTime();
        return Math.max(updatedAt, createdAt) > generatedAtTime;
      });

    return {
      eventId,
      aiSummary: event.aiSummary,
      aiSummaryGeneratedAt: event.aiSummaryGeneratedAt,
      isAiSummaryOutdated,
      notes,
    };
  }

  public async generateAiSummary(eventId: string): Promise<EventAiInsights> {
    const event = await this.eventRepository.findById(eventId);

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const activities = await this.getRelevantCompletedActivities(eventId);

    if (!activities.length) {
      throw new BadRequestException(
        'Cannot generate AI summary without completed activity notes',
      );
    }

    const summary = await this.aiService.generateEventSummary(
      event.name,
      event.startDate,
      activities.map((activity) => ({
        volunteerName: activity.volunteer?.name,
        traineeName: activity.trainee?.name,
        status: activity.status,
        notes: activity.notes?.trim() ?? '',
        startTime: activity.startTime,
        endTime: activity.endTime,
      })),
    );

    const updatedEvent = await this.eventRepository.updateAiSummary(
      eventId,
      summary,
      new Date(),
    );

    if (!updatedEvent) {
      throw new NotFoundException('Event not found');
    }

    return this.getEventAiInsights(eventId);
  }

  public async sendEventAssignments(
    eventId: string,
  ): Promise<EventAssignmentEmailResult> {
    const event = await this.eventRepository.findById(eventId);

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const recipients =
      await this.attendeeService.getEventAssignmentRecipients(eventId);
    const result: EventAssignmentEmailResult = {
      eventId,
      totalAttendingMentors: recipients.length,
      sentCount: 0,
      skippedCount: 0,
      failedCount: 0,
      skipped: [],
      failed: [],
    };

    for (const recipient of recipients) {
      if (!this.isValidEmail(recipient.mentorEmail)) {
        result.skippedCount += 1;
        result.skipped.push({
          userId: recipient.mentorId,
          name: recipient.mentorName,
          reason: 'missing_email',
        });
        this.logger.log(
          `Event assignment email skipped: eventId=${eventId} userId=${recipient.mentorId} reason=missing_email`,
        );
        continue;
      }

      try {
        await this.emailService.sendEmail(
          this.buildAssignmentEmail(event, recipient),
        );
        result.sentCount += 1;
        this.logger.log(
          `Event assignment email sent: eventId=${eventId} userId=${recipient.mentorId}`,
        );
      } catch (error) {
        result.failedCount += 1;
        result.failed.push({
          userId: recipient.mentorId,
          name: recipient.mentorName,
          reason: 'email_send_failed',
        });
        this.logger.warn(
          `Event assignment email failed: eventId=${eventId} userId=${recipient.mentorId}`,
        );
      }
    }

    return result;
  }

  private serializeEvent(event: Event): IEvent {
    const plainEvent = event.toJSON() as IEvent;
    delete plainEvent.aiSummary;
    delete plainEvent.aiSummaryGeneratedAt;

    return {
      ...plainEvent,
      imageUrl: this.supabaseStorageService.getPublicUrl(plainEvent.imagePath),
    };
  }

  private serializeCalendarBackground(
    background: any,
  ): CalendarMonthBackgroundResponse {
    const plain = background.toJSON() as CalendarMonthBackgroundResponse;

    return {
      ...plain,
      imageUrl: this.supabaseStorageService.getPublicUrl(plain.imagePath),
    };
  }

  private assertCalendarMonthKey(monthKey: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
      throw new BadRequestException('Invalid calendar month key');
    }
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

  private async getRelevantCompletedActivities(
    eventId: string,
  ): Promise<VolunteerActivity[]> {
    const activities =
      await this.activityRepository.findCompletedReportsByEvent(eventId);

    return activities.filter((activity) => Boolean(activity.notes?.trim()));
  }

  private toAiInsightNote(activity: VolunteerActivity): EventAiInsightNote {
    return {
      id: activity.id,
      volunteerName: activity.volunteer?.name ?? null,
      traineeName: activity.trainee?.name ?? null,
      status: activity.status,
      notes: activity.notes?.trim() ?? '',
      createdAt: activity.createdAt,
      updatedAt: activity.updatedAt,
    };
  }

  private buildAssignmentEmail(
    event: Event,
    recipient: {
      mentorName: string;
      mentorEmail: string | null;
      traineeName: string | null;
    },
  ) {
    const eventName = event.name;
    const eventDate = this.formatEventDate(event.startDate);
    const eventTime = this.formatEventTime(event.startDate);
    const eventLocation = event.address || 'לא צוין';
    const traineeLine = recipient.traineeName
      ? `החניך/ה המשובץ/ת אליך: ${recipient.traineeName}`
      : 'נכון לעכשיו לא קיים עבורך שיבוץ לחניך באירוע זה.';
    const subject = `שיבוץ לאירוע: ${eventName}`;
    const text = [
      `שלום ${recipient.mentorName},`,
      '',
      `את/ה רשום/ה כמשתתף/ת באירוע "${eventName}".`,
      '',
      `תאריך: ${eventDate}`,
      `שעה: ${eventTime}`,
      `מיקום: ${eventLocation}`,
      '',
      traineeLine,
      '',
      'בברכה,',
      'עת לעשות',
    ].join('\n');
    const html = `
      <div dir="rtl" style="font-family: Arial, sans-serif; line-height: 1.7; color: #222;">
        <p>שלום ${this.escapeHtml(recipient.mentorName)},</p>
        <p>את/ה רשום/ה כמשתתף/ת באירוע &quot;${this.escapeHtml(eventName)}&quot;.</p>
        <p>
          <strong>תאריך:</strong> ${this.escapeHtml(eventDate)}<br />
          <strong>שעה:</strong> ${this.escapeHtml(eventTime)}<br />
          <strong>מיקום:</strong> ${this.escapeHtml(eventLocation)}
        </p>
        <p>${this.escapeHtml(traineeLine)}</p>
        <p>בברכה,<br />עת לעשות</p>
      </div>
    `;

    return {
      to: recipient.mentorEmail!,
      subject,
      text,
      html,
    };
  }

  private isValidEmail(email?: string | null) {
    return Boolean(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  }

  private formatEventDate(value: Date | string | null | undefined) {
    const date = this.toValidDate(value);

    if (!date) {
      return 'לא צוין';
    }

    return new Intl.DateTimeFormat('he-IL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  }

  private formatEventTime(value: Date | string | null | undefined) {
    const date = this.toValidDate(value);

    if (!date) {
      return 'לא צוין';
    }

    return new Intl.DateTimeFormat('he-IL', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  private toValidDate(value: Date | string | null | undefined) {
    if (!value) {
      return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
