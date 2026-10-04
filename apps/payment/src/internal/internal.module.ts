import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transaction } from '../transactions/entities/transaction.entity';
import { WalletsModule } from '../wallets/wallets.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { PaymentProvidersModule } from '../providers/payment-providers.module';
import { InternalController } from './internal.controller';
import { InternalKeyGuard } from './internal-key.guard';
import { PostingsService } from './postings.service';
import { UnmatchedService } from './unmatched.service';
import { ReconciliationService } from './reconciliation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Transaction]),
    WalletsModule,
    NotificationsModule,
    PayoutsModule,
    PaymentProvidersModule,
  ],
  controllers: [InternalController],
  providers: [
    InternalKeyGuard,
    PostingsService,
    UnmatchedService,
    ReconciliationService,
  ],
})
export class InternalModule {}
