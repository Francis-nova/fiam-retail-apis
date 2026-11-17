import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletsModule } from '../wallets/wallets.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { PaymentAuthModule } from '../auth/payment-auth.module';
import { WebhookEvent } from '../webhooks/entities/webhook-event.entity';
import { StableStackCustomer } from './entities/stablestack-customer.entity';
import { StableStackClient } from './stablestack.client';
import { CryptoService } from './crypto.service';
import {
  CryptoController,
  StableStackWebhookController,
} from './crypto.controller';

// USDC/USDT wallets held at StableStack.
@Module({
  imports: [
    TypeOrmModule.forFeature([StableStackCustomer, WebhookEvent]),
    WalletsModule,
    TransactionsModule,
    PaymentAuthModule,
  ],
  controllers: [CryptoController, StableStackWebhookController],
  providers: [StableStackClient, CryptoService],
})
export class CryptoModule {}
