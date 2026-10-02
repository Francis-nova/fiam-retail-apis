import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transaction } from '../transactions/entities/transaction.entity';
import { WalletsModule } from '../wallets/wallets.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { InternalController } from './internal.controller';
import { InternalKeyGuard } from './internal-key.guard';
import { PostingsService } from './postings.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Transaction]),
    WalletsModule,
    NotificationsModule,
  ],
  controllers: [InternalController],
  providers: [InternalKeyGuard, PostingsService],
})
export class InternalModule {}
