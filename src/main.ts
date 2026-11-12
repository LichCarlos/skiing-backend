import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { configureHttp } from './shared/http/configure-http.js';
import { createOpenApiDocument } from './shared/http/openapi-document.js';
import { getAllowedWebOrigins } from './shared/http/web-origins.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureHttp(app);

  const allowedOrigins = getAllowedWebOrigins();
  app.enableCors({
    credentials: true,
    exposedHeaders: ['Retry-After'],
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin is not allowed by CORS'), false);
    },
  });

  SwaggerModule.setup('api/docs', app, createOpenApiDocument(app));

  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid TCP port');
  }
  await app.listen(port);
}

await bootstrap();
