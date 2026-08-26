import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import type { ErrorResponseDto } from '../dto/error-response.dto';

/**
 * Global error normaliser.
 *
 * Two decisions worth defending:
 *
 * 1. **One envelope, always.** Nest's default error bodies differ between a thrown
 *    `HttpException`, a `ValidationPipe` failure and an unhandled throw. Clients end up
 *    parsing three shapes and silently mishandling the third. Everything is flattened here.
 *
 * 2. **Unexpected errors do not leak their message in production.** An exception nobody
 *    anticipated can carry a file path, a row of data, or an upstream credential in its
 *    message. Outside production the message is passed through, because a prototype whose
 *    500s say nothing is a prototype nobody can debug — and the reasoning is visible here
 *    rather than being an accident of configuration.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const body: ErrorResponseDto = {
      statusCode: status,
      error: reasonPhrase(status),
      message: messageOf(exception, status),
      path: request.originalUrl ?? request.url,
      timestamp: new Date().toISOString(),
    };

    // Only genuinely unexpected failures are worth a stack trace in the log; a 404 is not
    // an incident, and logging it as one trains everybody to ignore the log.
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${body.path} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json(body);
  }
}

/** Nest's `HttpException` payload is `string | object`; both shapes appear in practice. */
function messageOf(exception: unknown, status: number): string | string[] {
  if (exception instanceof HttpException) {
    const payload = exception.getResponse();
    if (typeof payload === 'string') return payload;
    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.map(String);
    return exception.message;
  }

  if (status >= HttpStatus.INTERNAL_SERVER_ERROR && process.env.NODE_ENV === 'production') {
    return 'Internal server error';
  }
  return exception instanceof Error ? exception.message : 'Internal server error';
}

const PHRASES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

function reasonPhrase(status: number): string {
  return PHRASES[status] ?? (status >= 500 ? 'Internal Server Error' : 'Error');
}
