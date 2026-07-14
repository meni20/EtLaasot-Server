import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import { getOptionalEnv, getRequiredEnv } from 'src/config/env.util';

export interface EventSummaryActivityInput {
  volunteerName?: string | null;
  traineeName?: string | null;
  status?: string | null;
  notes: string;
  startTime?: Date | string | null;
  endTime?: Date | string | null;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly model: string =
    getOptionalEnv('GOOGLE_GENAI_MODEL', 'gemini-2.5-flash') ??
    'gemini-2.5-flash';
  private client?: GoogleGenAI;

  public async generateEventSummary(
    eventName: string,
    eventDate: Date | string | null,
    activities: EventSummaryActivityInput[],
  ): Promise<string> {
    try {
      const response = await this.getClient().models.generateContent({
        model: this.model,
        contents: this.buildPrompt(eventName, eventDate, activities),
      });

      const summary = response.text?.trim();

      if (!summary) {
        throw new Error('AI response did not include summary text');
      }

      return summary;
    } catch (error) {
      this.logger.error(
        `Failed to generate event AI summary: ${this.getErrorMessage(error)}`,
      );
      throw new InternalServerErrorException(
        'Failed to generate event AI summary',
      );
    }
  }

  private buildPrompt(
    eventName: string,
    eventDate: Date | string | null,
    activities: EventSummaryActivityInput[],
  ): string {
    const formattedEventDate = this.formatDate(eventDate);
    const activityLines = activities
      .map((activity, index) => {
        return [
          `דיווח ${index + 1}:`,
          `מתנדב/ת: ${activity.volunteerName || 'לא צוין'}`,
          `חניך/ה: ${activity.traineeName || 'לא צוין'}`,
          `סטטוס: ${activity.status || 'לא צוין'}`,
          `שעת התחלה: ${this.formatDate(activity.startTime)}`,
          `שעת סיום: ${this.formatDate(activity.endTime)}`,
          `הערות: ${activity.notes}`,
        ].join('\n');
      })
      .join('\n\n');

    return `
אתה מסייע לרכז/מנהל בעמותת את לעשות לסכם אירוע על בסיס דיווחי פעילות של מתנדבים בלבד.

כללים חשובים:
- סכם רק לפי ההערות והנתונים שסופקו כאן.
- אל תמציא פרטים חסרים, סיבות, מספרים או מסקנות שאינן מופיעות בדיווחים.
- הדגש מקרים חריגים, רגישים, חוזרים או קריטיים אם הם מופיעים בהערות.
- ציין שמות מתנדבים וחניכים כאשר הם רלוונטיים להבנת הסיכום.
- אם אין מספיק מידע לנושא מסוים, כתוב זאת בקצרה.
- החזר Markdown בעברית, ברור ותמציתי.

פרטי האירוע:
שם האירוע: ${eventName}
תאריך האירוע: ${formattedEventDate}

דיווחי הפעילות:
${activityLines}
`.trim();
  }

  private getClient(): GoogleGenAI {
    if (!this.client) {
      try {
        this.client = new GoogleGenAI({
          apiKey: getRequiredEnv('GOOGLE_GENAI_API_KEY'),
        });
      } catch {
        throw new InternalServerErrorException(
          'AI summary generation is not configured',
        );
      }
    }

    return this.client;
  }

  private formatDate(value: Date | string | null | undefined): string {
    if (!value) {
      return 'לא צוין';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return 'לא צוין';
    }

    return date.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }
}
