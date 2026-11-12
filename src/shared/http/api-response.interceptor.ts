import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { map, Observable } from 'rxjs';
import type { ApiResponse } from './api-response.js';
import type { TracedRequest } from './request-trace.middleware.js';

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<unknown>> {
    const http = context.switchToHttp();
    const request = http.getRequest<TracedRequest>();
    const response = http.getResponse<Response>();

    return next.handle().pipe(
      map((data: unknown) => ({
        code: response.statusCode,
        msg: 'success',
        data,
        traceId: request.traceId,
      })),
    );
  }
}
