import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { POSTOFFICE_NOTIFICATION_QUEUE } from '@app/common';
import { AppModule } from './app.module';
import { PostofficeConfig } from './config/configuration';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Fiam Postoffice API')
    .setDescription(
      'Notification delivery (email/SMS/push). No REST API for other ' +
        'services — reached only via the RabbitMQ notification queue; the ' +
        'HTTP server here exists solely for health checks and these docs.',
    )
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const configService =
    app.get<ConfigService<PostofficeConfig, true>>(ConfigService);
  const rabbitmqUrl = configService.get<string>('rabbitmq.url', {
    infer: true,
  });
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [rabbitmqUrl],
      queue: POSTOFFICE_NOTIFICATION_QUEUE,
      queueOptions: {
        durable: true,
        deadLetterExchange: `${POSTOFFICE_NOTIFICATION_QUEUE}.dlx`,
      },
      // Manual ack — required. Auto-ack risks losing a notification if the
      // process crashes mid-send, since RabbitMQ would already have
      // considered it delivered.
      noAck: false,
    },
  });

  await app.startAllMicroservices();
  const port = configService.get('port', { infer: true });
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`Postoffice API running on port ${port}`);
  logger.log(`Swagger docs available at ${await app.getUrl()}/docs`);
  logger.log(
    `Listening for notifications on queue "${POSTOFFICE_NOTIFICATION_QUEUE}"`,
  );
}
void bootstrap();
