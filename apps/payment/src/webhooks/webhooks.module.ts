import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { TransactionsModule } from '../transactions/transactions.module';
import { PaymentProvidersModule } from '../providers/payment-providers.module';

@Module({
  imports: [TransactionsModule, PaymentProvidersModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
