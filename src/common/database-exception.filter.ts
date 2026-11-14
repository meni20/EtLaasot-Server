import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { BaseError } from 'sequelize';
import { safeDatabaseFailure } from './safe-database-failure';

@Catch(BaseError)
export class DatabaseExceptionFilter implements ExceptionFilter {
  catch(error: BaseError, host: ArgumentsHost) {
    const safeError = safeDatabaseFailure(error);
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(safeError.getStatus())
      .json(safeError.getResponse());
  }
}
