import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export type TracedRequest = Request & { traceId: string };

export function requestTraceMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const traceId = randomUUID();
  (request as TracedRequest).traceId = traceId;
  response.setHeader('x-trace-id', traceId);
  next();
}
