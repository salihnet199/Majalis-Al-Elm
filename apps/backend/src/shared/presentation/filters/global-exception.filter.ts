import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * GlobalExceptionFilter
 *
 * Converts ALL exceptions (HTTP, domain, unexpected) into the canonical
 * API error envelope defined in API-DESIGN.md:
 *
 * {
 *   "error": {
 *     "code": "AUTH_TOKEN_EXPIRED",
 *     "message": "Access token has expired",
 *     "details": [...],
 *     "trace_id": "01920abc-..."
 *   }
 * }
 *
 * P-08: Every error is logged as structured JSON with trace_id.
 * P-07: Never leaks stack traces or internal details to the client.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const traceId = (request.headers['x-trace-id'] as string) ?? '';

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let errorCode = 'INTERNAL_SERVER_ERROR';
    let message = 'An unexpected error occurred';
    let details: unknown[] = [];

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
        errorCode = this.statusToCode(statusCode);
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const resp = exceptionResponse as Record<string, unknown>;
        errorCode = (resp['code'] as string) ?? this.statusToCode(statusCode);
        message = (resp['message'] as string) ?? exception.message;
        // The wire shape keeps `details` an array. A single object is wrapped
        // rather than dropped: silently discarding the diagnostic an exception
        // deliberately attached (e.g. declared vs. verified byte counts on a
        // rejected upload) leaves the client with no way to explain the failure.
        details = Array.isArray(resp['details'])
          ? resp['details']
          : resp['details'] != null
            ? [resp['details']]
            : [];
      }
    } else if (exception instanceof Error) {
      // Domain errors — log with full stack in server, never expose to client
      this.logger.error({
        traceId,
        error: exception.message,
        stack: exception.stack,
        path: request.url,
        method: request.method,
      });
    } else {
      this.logger.error({ traceId, exception, path: request.url });
    }

    // Structured log for every error (P-08)
    if (statusCode >= 500) {
      this.logger.error({
        traceId,
        statusCode,
        errorCode,
        message,
        path: request.url,
        method: request.method,
        userAgent: request.headers['user-agent'],
      });
    } else {
      this.logger.warn({
        traceId,
        statusCode,
        errorCode,
        path: request.url,
        method: request.method,
      });
    }

    response.status(statusCode).json({
      error: {
        code: errorCode,
        message,
        ...(details.length > 0 && { details }),
        trace_id: traceId,
      },
    });
  }

  private statusToCode(status: number): string {
    const map: Record<number, string> = {
      400: 'VALIDATION_ERROR',
      401: 'AUTH_MISSING_TOKEN',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      410: 'RESOURCE_EXPIRED',
      422: 'UNPROCESSABLE',
      429: 'RATE_LIMITED',
      503: 'MAINTENANCE_MODE',
    };
    return map[status] ?? 'INTERNAL_SERVER_ERROR';
  }
}
