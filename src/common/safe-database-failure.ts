import { InternalServerErrorException, Logger } from '@nestjs/common';

const logger = new Logger('DatabaseOperation');
export const DATABASE_FAILURE_MESSAGE = 'אירעה שגיאה בשרת. נסו שוב מאוחר יותר.';

export function safeDatabaseFailure(error: unknown) {
  const candidate = error as {
    original?: { code?: unknown };
    parent?: { code?: unknown };
  } | null;
  const code = candidate?.original?.code ?? candidate?.parent?.code;
  logger.error(
    typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)
      ? `Database operation failed (SQLSTATE ${code})`
      : 'Database operation failed',
  );
  return new InternalServerErrorException(DATABASE_FAILURE_MESSAGE);
}
