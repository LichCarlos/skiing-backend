import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureHttp } from './shared/http/configure-http.js';
import { createOpenApiDocument } from './shared/http/openapi-document.js';

// Contract export only instantiates providers; it must not require a deployment secret.
process.env.JWT_ACCESS_SECRET ??= randomBytes(32).toString('base64url');
process.env.LOGIN_RATE_LIMIT_SECRET ??= randomBytes(32).toString('base64url');
process.env.OPENAPI_EXPORT = 'true';

const app = await NestFactory.create(AppModule, { logger: false });
try {
  configureHttp(app);
  await app.init();
  const document = createOpenApiDocument(app);
  await mkdir('contracts', { recursive: true });
  await writeFile(
    'contracts/openapi.json',
    `${JSON.stringify(document, null, 2)}\n`,
    'utf8',
  );
} finally {
  await app.close();
}
