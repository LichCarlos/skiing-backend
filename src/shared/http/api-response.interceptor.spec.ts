import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { ApiResponseInterceptor } from './api-response.interceptor.js';

describe('ApiResponseInterceptor', () => {
  it('wraps handler data with the HTTP status and request trace ID', async () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ traceId: 'trace-456' }),
        getResponse: () => ({ statusCode: 201 }),
      }),
    } as ExecutionContext;
    const next = { handle: () => of({ id: 7 }) } as CallHandler;
    const interceptor = new ApiResponseInterceptor();

    await expect(
      lastValueFrom(interceptor.intercept(context, next)),
    ).resolves.toEqual({
      code: 201,
      msg: 'success',
      data: { id: 7 },
      traceId: 'trace-456',
    });
  });
});
