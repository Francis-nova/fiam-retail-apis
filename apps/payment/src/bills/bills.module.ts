import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transaction } from '../transactions/entities/transaction.entity';
import { BillBeneficiary } from './entities/bill-beneficiary.entity';
import { BillBeneficiariesService } from './bill-beneficiaries.service';
import { BillsController } from './bills.controller';
import { BillsService } from './bills.service';
import { CustomerPhoneService } from './customer-phone';
import { BillStatusQueryProcessor } from './bill-status-query.processor';
import { BILL_STATUS_QUERY_QUEUE } from './bill-status-query.queue';
import { WalletsModule } from '../wallets/wallets.module';
import { PaymentProvidersModule } from '../providers/payment-providers.module';
import { PaymentAuthModule } from '../auth/payment-auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Transaction, BillBeneficiary]),
    BullModule.registerQueue({ name: BILL_STATUS_QUERY_QUEUE }),
    WalletsModule,
    PaymentProvidersModule,
    PaymentAuthModule,
    NotificationsModule,
    RedisModule,
    // For PinVerifierService.
    PayoutsModule,
  ],
  controllers: [BillsController],
  providers: [
    BillsService,
    BillBeneficiariesService,
    BillStatusQueryProcessor,
    CustomerPhoneService,
  ],
})
export class BillsModule {}
