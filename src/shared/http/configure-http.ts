import {
  BadRequestException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { ApiExceptionFilter } from './api-exception.filter.js';
import { ApiResponseInterceptor } from './api-response.interceptor.js';
import { requestTraceMiddleware } from './request-trace.middleware.js';
import { toValidationErrorDetails } from './validation-error-details.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { trustedProxyAllowlist } from './trusted-proxies.js';

export function configureHttp(app: INestApplication): void {
  (app as NestExpressApplication).set('trust proxy', trustedProxyAllowlist());
  app.setGlobalPrefix('api/v1');
  app.use(requestTraceMiddleware);
  // 30,000 Unicode policy characters may exceed Express's default 100 KiB.
  // Keep a bounded JSON transport budget; per-field DTO/domain limits still apply.
  (app as NestExpressApplication).useBodyParser('json', { limit: '512kb' });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors) =>
        new BadRequestException({
          message: 'Request validation failed',
          details: toValidationErrorDetails(errors),
        }),
    }),
  );
  app.useGlobalInterceptors(new ApiResponseInterceptor());
  app.useGlobalFilters(new ApiExceptionFilter());
}
