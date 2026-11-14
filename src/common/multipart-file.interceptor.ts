import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  PayloadTooLargeException,
  mixin,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

const clientErrorCodes = new Set([
  'LIMIT_PART_COUNT',
  'LIMIT_FILE_COUNT',
  'LIMIT_FIELD_KEY',
  'LIMIT_FIELD_VALUE',
  'LIMIT_FIELD_COUNT',
  'LIMIT_UNEXPECTED_FILE',
  'MISSING_FIELD_NAME',
  'LIMIT_FIELD_NESTING',
  'LIMIT_FIELD_ARRAY_INDEX',
  'INVALID_FIELD_NAME',
  'STREAM_DESTROYED',
]);

// Nest 11.1 maps Multer errors by message. Multer 2.5 changes some messages.
export function MultipartFileInterceptor(
  ...args: Parameters<typeof FileInterceptor>
) {
  const Base = FileInterceptor(...args);
  return mixin(
    class extends Base {
      async intercept(context: ExecutionContext, next: CallHandler) {
        try {
          return await super.intercept(context, next);
        } catch (error) {
          const candidate = error as { name?: string; code?: string } | null;
          if (candidate?.name === 'MulterError') {
            if (candidate.code === 'LIMIT_FILE_SIZE')
              throw new PayloadTooLargeException('File too large');
            if (candidate.code && clientErrorCodes.has(candidate.code))
              throw new BadRequestException('Invalid multipart upload');
          }
          throw error;
        }
      }
    },
  );
}
