import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transaction } from '../transactions/entities/transaction.entity';
import { PayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';
import { PayoutStatusQueryProcessor } from './payout-status-query.processor';
import { PAYOUT_STATUS_QUERY_QUEUE } from './payout-status-query.queue';
import { WalletsModule } from '../wallets/wallets.module';
import { BeneficiariesModule } from '../beneficiaries/beneficiaries.module';
import { BanksModule } from '../banks/banks.module';
import { PaymentProvidersModule } from '../providers/payment-providers.module';
import { PaymentAuthModule } from '../auth/payment-auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Transaction]),
    BullModule.registerQueue({ name: PAYOUT_STATUS_QUERY_QUEUE }),
    WalletsModule,
    BeneficiariesModule,
    BanksModule,
    PaymentProvidersModule,
    PaymentAuthModule,
  ],
  controllers: [PayoutsController],
  providers: [PayoutsService, PayoutStatusQueryProcessor],
})
export class PayoutsModule {}
