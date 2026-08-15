import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { AppController } from './app.controller';
import configuration, { PaymentConfig } from './config/configuration';
import { validate } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { WalletsModule } from './wallets/wallets.module';
import { MessagingModule } from './messaging/messaging.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { TransactionsModule } from './transactions/transactions.module';
import { BanksModule } from './banks/banks.module';
import { BeneficiariesModule } from './beneficiaries/beneficiaries.module';
import { PayoutsModule } from './payouts/payouts.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: 'apps/payment/.env',
      load: [configuration],
      validate,
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<PaymentConfig, true>) => {
        const redisUrl = configService.get<string>('redis.url', {
          infer: true,
        });
        return { connection: { url: redisUrl } };
      },
    }),
    DatabaseModule,
    WalletsModule,
    MessagingModule,
    WebhooksModule,
    TransactionsModule,
    BanksModule,
    BeneficiariesModule,
    PayoutsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
