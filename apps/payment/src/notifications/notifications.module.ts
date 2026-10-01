import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { POSTOFFICE_NOTIFICATION_QUEUE } from '@app/common';
import { PaymentConfig } from '../config/configuration';
import { NotificationsService } from './notifications.service';
import { POSTOFFICE_NOTIFICATION_CLIENT } from './postoffice-notification-client.token';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [
    WalletsModule,
    ClientsModule.registerAsync([
      {
        name: POSTOFFICE_NOTIFICATION_CLIENT,
        inject: [ConfigService],
        useFactory: (configService: ConfigService<PaymentConfig, true>) => ({
          transport: Transport.RMQ,
          options: {
            urls: [configService.get<string>('rabbitmq.url', { infer: true })],
            queue: POSTOFFICE_NOTIFICATION_QUEUE,
            // Must match the consumer's own queue declaration exactly
            // (apps/postoffice/src/main.ts), or RabbitMQ rejects it.
            queueOptions: {
              durable: true,
              deadLetterExchange: `${POSTOFFICE_NOTIFICATION_QUEUE}.dlx`,
            },
          },
        }),
      },
    ]),
  ],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
