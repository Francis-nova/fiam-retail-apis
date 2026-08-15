import { Module } from '@nestjs/common';
import { BanksController } from './banks.controller';
import { BanksService } from './banks.service';
import { RedisModule } from '../redis/redis.module';
import { PaymentProvidersModule } from '../providers/payment-providers.module';
import { PaymentAuthModule } from '../auth/payment-auth.module';

@Module({
  imports: [RedisModule, PaymentProvidersModule, PaymentAuthModule],
  controllers: [BanksController],
  providers: [BanksService],
  exports: [BanksService],
})
export class BanksModule {}
