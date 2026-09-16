import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from '@app/common';
import { AuthConfig } from './config/configuration';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());

  const configService = app.get<ConfigService<AuthConfig, true>>(ConfigService);
  // The mobile app targets native (no CORS enforcement there), but Expo's
  // web target and any future browser-based client need this — open in dev,
  // tightened once a real web origin exists in production.
  if (configService.get('env', { infer: true }) !== 'production') {
    app.enableCors({
      origin: configService.get('corsOrigin', { infer: true }),
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      credentials: true,
    });
  }

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Fiam Auth API')
    .setDescription(
      'Signup, sign-in, KYC/BVN, devices, and settings/security endpoints.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = configService.get('port', { infer: true });
  await app.listen(port, '0.0.0.0');

  const logger = new Logger('Bootstrap');
  logger.log(`Auth API running on port ${port}`);
  logger.log(`Swagger docs available at ${await app.getUrl()}/docs`);
}
void bootstrap();
