import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletsModule } from '../wallets/wallets.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { PaymentAuthModule } from '../auth/payment-auth.module';
import { WebhookEvent } from '../webhooks/entities/webhook-event.entity';
import { Transaction } from '../transactions/entities/transaction.entity';
import { PayoutsModule } from '../payouts/payouts.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CryptoWithdrawalStatusProcessor } from './crypto-withdrawal-status.processor';
import { StableStackCustomer } from './entities/stablestack-customer.entity';
import { StableStackClient } from './stablestack.client';
import {
  CRYPTO_WITHDRAWAL_STATUS_QUEUE,
  CryptoService,
} from './crypto.service';
import {
  CryptoController,
  StableStackWebhookController,
} from './crypto.controller';

// USDC/USDT wallets held at StableStack.
@Module({
  imports: [
    TypeOrmModule.forFeature([StableStackCustomer, WebhookEvent, Transaction]),
    BullModule.registerQueue({ name: CRYPTO_WITHDRAWAL_STATUS_QUEUE }),
    WalletsModule,
    PayoutsModule,
    NotificationsModule,
    TransactionsModule,
    PaymentAuthModule,
  ],
  controllers: [CryptoController, StableStackWebhookController],
  providers: [
    StableStackClient,
    CryptoService,
    CryptoWithdrawalStatusProcessor,
  ],
})
export class CryptoModule {}
