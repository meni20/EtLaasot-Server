import { ACTIVITY_TIMEZONE } from './activity.constants';

type DateBoundary = 'start' | 'end';

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const zonedDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ACTIVITY_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function getZonedDateParts(
  value: Date | string,
  timeZone = ACTIVITY_TIMEZONE,
): ZonedParts {
  const formatter =
    timeZone === ACTIVITY_TIMEZONE
      ? zonedDateFormatter
      : new Intl.DateTimeFormat('en-CA', {
          timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });

  const date = value instanceof Date ? value : new Date(value);
  const parts = formatter.formatToParts(date);
  const partValue = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return {
    year: partValue('year'),
    month: partValue('month'),
    day: partValue('day'),
    hour: partValue('hour'),
    minute: partValue('minute'),
    second: partValue('second'),
  };
}

export function getCurrentYearInTimeZone(
  timeZone = ACTIVITY_TIMEZONE,
): number {
  return getZonedDateParts(new Date(), timeZone).year;
}

function zonedDateTimeToUtc(
  input: ZonedParts & { millisecond?: number },
  timeZone = ACTIVITY_TIMEZONE,
) {
  let guess = Date.UTC(
    input.year,
    input.month - 1,
    input.day,
    input.hour,
    input.minute,
    input.second,
    input.millisecond ?? 0,
  );

  for (let iteration = 0; iteration < 2; iteration += 1) {
    const parts = getZonedDateParts(new Date(guess), timeZone);
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      input.millisecond ?? 0,
    );
    guess -= asUtc - guess;
  }

  return new Date(guess);
}

export function parseActivityDateFilter(
  value?: string,
  boundary: DateBoundary = 'start',
  timeZone = ACTIVITY_TIMEZONE,
): Date | undefined {
  if (!value) {
    return undefined;
  }

  if (value.includes('T')) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  const [year, month, day] = value.split('-').map(Number);

  if (!year || !month || !day) {
    return undefined;
  }

  return zonedDateTimeToUtc(
    {
      year,
      month,
      day,
      hour: boundary === 'start' ? 0 : 23,
      minute: boundary === 'start' ? 0 : 59,
      second: boundary === 'start' ? 0 : 59,
      millisecond: boundary === 'start' ? 0 : 999,
    },
    timeZone,
  );
}

export function calculateDurationMinutes(
  startTime?: Date | string | null,
  endTime?: Date | string | null,
) {
  if (!startTime) {
    return null;
  }

  const start = new Date(startTime);
  const end = endTime ? new Date(endTime) : new Date();

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end.getTime() < start.getTime()
  ) {
    return null;
  }

  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

export function formatDurationMinutes(totalMinutes: number | null) {
  if (totalMinutes === null || totalMinutes < 0) {
    return null;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (!hours) {
    return `${minutes}m`;
  }

  if (!minutes) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
}

