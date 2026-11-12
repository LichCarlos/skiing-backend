import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiErrorDetail, ApiErrorResponse } from './api-response.js';
import type { TracedRequest } from './request-trace.middleware.js';
import {
  diagnosticTraceId,
  failureDiagnostic,
} from '../diagnostics/failure-diagnostic.js';

type HttpErrorBody = {
  details?: unknown;
  error?: unknown;
  message?: unknown;
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<TracedRequest>();
    const response = http.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const body =
      exception instanceof HttpException ? exception.getResponse() : null;
    const details = getErrorDetails(body);
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error({
        event: 'http_request_failed',
        traceId: diagnosticTraceId(request.traceId),
        status,
        failure: failureDiagnostic(exception),
      });
    }

    const payload: ApiErrorResponse = {
      code: status,
      msg: getErrorMessage(exception, body, status, details),
      data: null,
      traceId: request.traceId,
      ...(details ? { details } : {}),
    };

    response.status(status).json(payload);
  }
}

function getErrorDetails(body: unknown): ApiErrorDetail[] | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const explicitDetails = (body as HttpErrorBody).details;
  if (Array.isArray(explicitDetails)) {
    const details = explicitDetails.filter(isApiErrorDetail);
    if (details.length > 0) return details;
  }

  const messages = (body as HttpErrorBody).message;
  if (!Array.isArray(messages)) return undefined;

  return messages
    .filter((message): message is string => typeof message === 'string')
    .map((message) => ({ code: 'VALIDATION_ERROR', message }));
}

function isApiErrorDetail(value: unknown): value is ApiErrorDetail {
  if (!value || typeof value !== 'object') return false;
  const detail = value as Partial<ApiErrorDetail>;
  return (
    typeof detail.code === 'string' &&
    typeof detail.message === 'string' &&
    (detail.field === undefined || typeof detail.field === 'string')
  );
}

function getErrorMessage(
  exception: unknown,
  body: unknown,
  status: number,
  details: ApiErrorDetail[] | undefined,
): string {
  if (status >= HttpStatus.INTERNAL_SERVER_ERROR)
    return 'Internal server error';
  if (details) return 'Request validation failed';
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') {
    const errorBody = body as HttpErrorBody;
    if (typeof errorBody.message === 'string') return errorBody.message;
    if (typeof errorBody.error === 'string') return errorBody.error;
  }
  return exception instanceof Error ? exception.message : 'Request failed';
}
