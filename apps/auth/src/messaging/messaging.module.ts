import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { PAYMENT_ACCOUNT_PROVISIONING_QUEUE } from '@app/common';
import { AuthConfig } from '../config/configuration';
import { PaymentProvisioningPublisher } from './payment-provisioning.publisher';
import { PAYMENT_PROVISIONING_CLIENT } from './payment-provisioning-client.token';

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
    ]),
  ],
  providers: [PaymentProvisioningPublisher],
  exports: [PaymentProvisioningPublisher],
})
export class MessagingModule {}
