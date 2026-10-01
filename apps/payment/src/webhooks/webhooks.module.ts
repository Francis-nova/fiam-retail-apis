import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhookEvent } from './entities/webhook-event.entity';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { TransactionsModule } from '../transactions/transactions.module';
import { PaymentProvidersModule } from '../providers/payment-providers.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookEvent]),
    TransactionsModule,
    PaymentProvidersModule,
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
