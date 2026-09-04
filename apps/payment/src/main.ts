import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  HttpExceptionFilter,
  PAYMENT_ACCOUNT_PROVISIONING_QUEUE,
} from '@app/common';
import { AppModule } from './app.module';
import { PaymentConfig } from './config/configuration';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());

  const configService =
    app.get<ConfigService<PaymentConfig, true>>(ConfigService);
  if (configService.get('env', { infer: true }) !== 'production') {
    app.enableCors({
      origin: configService.get('corsOrigin', { infer: true }),
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      credentials: true,
    });
  }

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Fiam Payment API')
    .setDescription(
      'Wallet/address provisioning, provider webhook, and wallet-read endpoints.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const rabbitmqUrl = configService.get<string>('rabbitmq.url', {
    infer: true,
  });
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [rabbitmqUrl],
      queue: PAYMENT_ACCOUNT_PROVISIONING_QUEUE,
      queueOptions: {
        durable: true,
        deadLetterExchange: `${PAYMENT_ACCOUNT_PROVISIONING_QUEUE}.dlx`,
      },
      // Manual ack — required. Auto-ack risks losing a message if the
      // process crashes mid-VFD-call, since RabbitMQ would already have
      // considered it delivered.
      noAck: false,
    },
  });

  await app.startAllMicroservices();
  const port = configService.get('port', { infer: true });
  await app.listen(port, '0.0.0.0');

  const logger = new Logger('Bootstrap');
  logger.log(`Payment API running on port ${port}`);
  logger.log(`Swagger docs available at ${await app.getUrl()}/docs`);
}
bootstrap();
