import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import {
  PAYMENT_ACCOUNT_PROVISIONING_QUEUE,
  POSTOFFICE_NOTIFICATION_QUEUE,
} from '@app/common';
import { AuthConfig } from '../config/configuration';
import { PaymentProvisioningPublisher } from './payment-provisioning.publisher';
import { PAYMENT_PROVISIONING_CLIENT } from './payment-provisioning-client.token';
import { NotificationPublisher } from './notification.publisher';
import { POSTOFFICE_NOTIFICATION_CLIENT } from './postoffice-notification-client.token';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: PAYMENT_PROVISIONING_CLIENT,
        inject: [ConfigService],
        useFactory: (configService: ConfigService<AuthConfig, true>) => {
          const rabbitmqUrl = configService.get<string>('rabbitmq.url', {
            infer: true,
          });
          return {
            transport: Transport.RMQ,
            options: {
              urls: [rabbitmqUrl],
              queue: PAYMENT_ACCOUNT_PROVISIONING_QUEUE,
              queueOptions: {
                durable: true,
                deadLetterExchange: `${PAYMENT_ACCOUNT_PROVISIONING_QUEUE}.dlx`,
              },
            },
          };
        },
      },
      {
        name: POSTOFFICE_NOTIFICATION_CLIENT,
        inject: [ConfigService],
        useFactory: (configService: ConfigService<AuthConfig, true>) => {
          const rabbitmqUrl = configService.get<string>('rabbitmq.url', {
            infer: true,
          });
          return {
            transport: Transport.RMQ,
            options: {
              urls: [rabbitmqUrl],
              queue: POSTOFFICE_NOTIFICATION_QUEUE,
              queueOptions: {
                durable: true,
                deadLetterExchange: `${POSTOFFICE_NOTIFICATION_QUEUE}.dlx`,
              },
            },
          };
        },
      },
    ]),
  ],
  providers: [PaymentProvisioningPublisher, NotificationPublisher],
  exports: [PaymentProvisioningPublisher, NotificationPublisher],
})
export class MessagingModule {}
