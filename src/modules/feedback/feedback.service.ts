import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AUTH_ROLES } from 'src/constants/auth.constants';
import { EmailService } from '../email/email.service';
import { FeatureRequestDto } from './dtos/feature-request.dto';

export type FeedbackActor = {
  userId?: string;
  name?: string;
  roles?: Array<{
    roleId?: number;
    role?: string;
    branchName?: string;
  }>;
};

const ROLE_NAMES = new Map(
  Object.values(AUTH_ROLES).map((role) => [role.id, role.name]),
);

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  async submitFeatureRequest(actor: FeedbackActor, request: FeatureRequestDto) {
    const recipient = this.configService
      .get<string>('FEATURE_REQUEST_EMAIL')
      ?.trim();

    if (!recipient) {
      this.logger.error('FEATURE_REQUEST_EMAIL is not configured');
      throw new InternalServerErrorException(
        'Feedback service is not configured',
      );
    }

    const senderName = actor.name?.trim() || 'משתמש לא מזוהה';
    const branchNames = this.uniqueValues(
      actor.roles?.map((role) => role.branchName) ?? [],
    );
    const roleNames = this.uniqueValues(
      actor.roles?.map(
        (role) => ROLE_NAMES.get(Number(role.roleId)) ?? role.role,
      ) ?? [],
    );
    const submittedAt = new Intl.DateTimeFormat('he-IL', {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'Asia/Jerusalem',
    }).format(new Date());

    const details = {
      senderName,
      branches: branchNames.join(', ') || 'לא זמין',
      roles: roleNames.join(', ') || 'לא זמין',
      title: request.title.trim(),
      description: request.description.trim(),
      submittedAt,
    };

    try {
      await this.emailService.sendEmail({
        to: recipient,
        subject: 'בקשת פיצ׳ר חדשה - עת לעשות',
        text: this.buildTextEmail(details),
        html: this.buildHtmlEmail(details),
      });
    } catch (error) {
      this.logger.error(
        'Feature request email delivery failed',
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException('Unable to submit feedback');
    }

    return { message: 'Feature request sent' };
  }

  private uniqueValues(values: Array<string | undefined>) {
    return [
      ...new Set(values.map((value) => value?.trim()).filter(Boolean)),
    ] as string[];
  }

  private buildTextEmail(details: Record<string, string>) {
    return [
      'בקשת פיצ׳ר חדשה - עת לעשות',
      '',
      `שם: ${details.senderName}`,
      `סניף: ${details.branches}`,
      `תפקיד: ${details.roles}`,
      `תאריך שליחה: ${details.submittedAt}`,
      '',
      `כותרת: ${details.title}`,
      '',
      'תיאור:',
      details.description,
    ].join('\n');
  }

  private buildHtmlEmail(details: Record<string, string>) {
    const escaped = Object.fromEntries(
      Object.entries(details).map(([key, value]) => [
        key,
        this.escapeHtml(value),
      ]),
    );

    return `
      <div dir="rtl" style="font-family: Arial, sans-serif; color: #2f2930; line-height: 1.6; max-width: 680px; margin: 0 auto;">
        <h2 style="margin: 0 0 20px; color: #4d284f;">בקשת פיצ׳ר חדשה - עת לעשות</h2>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          <tr><td style="padding: 5px 0; font-weight: 700; width: 110px;">שם</td><td>${escaped.senderName}</td></tr>
          <tr><td style="padding: 5px 0; font-weight: 700;">סניף</td><td>${escaped.branches}</td></tr>
          <tr><td style="padding: 5px 0; font-weight: 700;">תפקיד</td><td>${escaped.roles}</td></tr>
          <tr><td style="padding: 5px 0; font-weight: 700;">תאריך שליחה</td><td>${escaped.submittedAt}</td></tr>
        </table>
        <h3 style="margin: 0 0 8px;">${escaped.title}</h3>
        <div style="white-space: pre-wrap; padding: 16px; background: #f7f4f7; border: 1px solid #e5dfe6; border-radius: 10px;">${escaped.description}</div>
      </div>
    `.trim();
  }

  private escapeHtml(value: string) {
    return value.replace(/[&<>'"]/g, (character) => {
      const entities: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      };
      return entities[character];
    });
  }
}
