import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wallet } from '../wallets/entities/wallet.entity';
import { PaymentProvidersModule } from '../providers/payment-providers.module';
import { PaymentSlackModule } from '../slack/payment-slack.module';
import { POOL_BALANCE_QUEUE } from './pool-balance.queue';
import { PoolBalanceService } from './pool-balance.service';
import { PoolBalanceProcessor } from './pool-balance.processor';
import { PoolBalanceScheduler } from './pool-balance.scheduler';

@Module({
  imports: [
    TypeOrmModule.forFeature([Wallet]),
    BullModule.registerQueue({ name: POOL_BALANCE_QUEUE }),
    PaymentProvidersModule,
    PaymentSlackModule,
  ],
  providers: [PoolBalanceService, PoolBalanceProcessor, PoolBalanceScheduler],
})
export class TreasuryModule {}
