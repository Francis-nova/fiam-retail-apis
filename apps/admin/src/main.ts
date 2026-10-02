import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from '@app/common';
import { AdminConfig } from './config/configuration';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());

  const config = app.get<ConfigService<AdminConfig, true>>(ConfigService);
  // Unlike the customer APIs this one is always called from a browser, so
  // CORS stays on in production — CORS_ORIGIN must then be the console's origin.
  app.enableCors({
    origin: config.get('corsOrigin', { infer: true }),
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  });

  if (config.get('env', { infer: true }) !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Fiam Admin API')
        .setDescription('Back-office console API: staff, users, KYC, payments.')
        .setVersion('1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('docs', app, document);
  }

  const port = config.get('port', { infer: true });
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`Admin API running on port ${port}`);
}
void bootstrap();
