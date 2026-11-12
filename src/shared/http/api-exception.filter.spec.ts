import {
  BadRequestException,
  Logger,
  type ArgumentsHost,
} from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiExceptionFilter } from './api-exception.filter.js';
import { UpstreamHttpError } from '../diagnostics/failure-diagnostic.js';

function createHost(traceId = 'trace-123') {
  const response = {
    json: vi.fn(),
    status: vi.fn(),
  };
  response.status.mockReturnValue(response);
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ traceId }),
      getResponse: () => response,
    }),
  } as ArgumentsHost;

  return { host, response };
}

describe('ApiExceptionFilter', () => {
  let log: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());
  it('maps validation errors to the shared error envelope', () => {
    const { host, response } = createHost();
    const filter = new ApiExceptionFilter();

    filter.catch(new BadRequestException(['account must be a string']), host);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      code: 400,
      msg: 'Request validation failed',
      data: null,
      traceId: 'trace-123',
      details: [
        { code: 'VALIDATION_ERROR', message: 'account must be a string' },
      ],
    });
    expect(log).not.toHaveBeenCalled();
  });

  it('does not expose internal errors', () => {
    const { host, response } = createHost();
    const filter = new ApiExceptionFilter();

    filter.catch(new Error('database password leaked'), host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      code: 500,
      msg: 'Internal server error',
      data: null,
      traceId: 'trace-123',
    });
    expect(log).toHaveBeenCalledWith({
      event: 'http_request_failed',
      traceId: null,
      status: 500,
      failure: { kind: 'unexpected', upstreamStatus: null, code: null },
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('password');
  });
  it('correlates an upstream failure with the server UUID without changing the error envelope', () => {
    const traceId = '2e24f7fe-36e3-4a9a-9293-f6c3ecad7027';
    const { host, response } = createHost(traceId);
    new ApiExceptionFilter().catch(
      new UpstreamHttpError(503, 'secret prompt'),
      host,
    );
    expect(log).toHaveBeenCalledExactlyOnceWith({
      event: 'http_request_failed',
      traceId,
      status: 500,
      failure: { kind: 'upstream_http', upstreamStatus: 503, code: null },
    });
    expect(response.json).toHaveBeenCalledWith({
      code: 500,
      msg: 'Internal server error',
      data: null,
      traceId,
    });
  });
});
