import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
}

export interface SendEmailResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
}

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  appPassword: string;
  from: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter?: Transporter;

  public constructor(private readonly configService: ConfigService) {}

  public async verifyConnection(): Promise<void> {
    try {
      await this.getTransporter().verify();
    } catch (error) {
      this.logger.error(
        'SMTP connection verification failed',
        this.getSafeErrorMessage(error),
      );
      throw new InternalServerErrorException(
        'Email service is not available',
      );
    }
  }

  public async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    const smtpConfig = this.getSmtpConfig();

    try {
      const result = await this.getTransporter().sendMail({
        from: smtpConfig.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });

      return {
        messageId: result.messageId,
        accepted: this.normalizeAddressList(result.accepted),
        rejected: this.normalizeAddressList(result.rejected),
      };
    } catch (error) {
      this.logger.error('Failed to send email', this.getSafeErrorMessage(error));
      throw new InternalServerErrorException('Failed to send email');
    }
  }

  private getTransporter(): Transporter {
    if (!this.transporter) {
      const smtpConfig = this.getSmtpConfig();

      this.transporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure,
        auth: {
          user: smtpConfig.user,
          pass: smtpConfig.appPassword,
        },
      });
    }

    return this.transporter;
  }

  private getSmtpConfig(): SmtpConfig {
    const host = this.getRequiredConfig('SMTP_HOST');
    const port = this.parsePort(this.getRequiredConfig('SMTP_PORT'));
    const secure = this.parseBoolean(this.getRequiredConfig('SMTP_SECURE'));
    const user = this.getRequiredConfig('SMTP_USER');
    const appPassword = this.getRequiredConfig('SMTP_APP_PASSWORD');
    const from = this.getRequiredConfig('EMAIL_FROM');

    return {
      host,
      port,
      secure,
      user,
      appPassword,
      from,
    };
  }

  private getRequiredConfig(key: string): string {
    const value = this.configService.get<string>(key)?.trim();

    if (!value) {
      throw new InternalServerErrorException(
        `Missing email configuration: ${key}`,
      );
    }

    return value;
  }

  private parsePort(value: string): number {
    const port = Number(value);

    if (!Number.isInteger(port) || port <= 0) {
      throw new InternalServerErrorException('Invalid SMTP_PORT configuration');
    }

    return port;
  }

  private parseBoolean(value: string): boolean {
    const normalizedValue = value.trim().toLowerCase();

    if (['true', '1', 'yes'].includes(normalizedValue)) {
      return true;
    }

    if (['false', '0', 'no'].includes(normalizedValue)) {
      return false;
    }

    throw new InternalServerErrorException(
      'Invalid SMTP_SECURE configuration',
    );
  }

  private normalizeAddressList(addresses: unknown): string[] {
    if (!Array.isArray(addresses)) {
      return [];
    }

    return addresses
      .map((address) => String(address))
      .filter((address) => address.trim().length > 0);
  }

  private getSafeErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return 'Unknown SMTP error';
  }
}
