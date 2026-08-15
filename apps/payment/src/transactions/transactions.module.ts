import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transaction } from './entities/transaction.entity';
import { TransactionsService } from './transactions.service';
import { TransactionsProcessor } from './transactions.processor';
import { TransactionsController } from './transactions.controller';
import { TRANSACTION_PROCESSING_QUEUE } from './transaction-processing.queue';
import { WalletsModule } from '../wallets/wallets.module';
import { PaymentAuthModule } from '../auth/payment-auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Transaction]),
    BullModule.registerQueue({ name: TRANSACTION_PROCESSING_QUEUE }),
    WalletsModule,
    PaymentAuthModule,
  ],
  controllers: [TransactionsController],
  providers: [TransactionsService, TransactionsProcessor],
  exports: [TransactionsService],
})
export class TransactionsModule {}
