import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';

export function createOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('凛迹雪客 API')
    .setDescription('滑雪社群综合服务平台 API')
    .setVersion('1.55.0')
    .build();

  return SwaggerModule.createDocument(app, config);
}
