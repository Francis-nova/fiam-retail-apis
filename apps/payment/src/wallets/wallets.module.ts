import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wallet } from './entities/wallet.entity';
import { Address } from './entities/address.entity';
import { WalletsService } from './wallets.service';
import { AddressService } from './address.service';
import { WalletsController } from './wallets.controller';
import { PaymentProvidersModule } from '../providers/payment-providers.module';
import { PaymentAuthModule } from '../auth/payment-auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Wallet, Address]),
    PaymentProvidersModule,
    PaymentAuthModule,
  ],
  controllers: [WalletsController],
  providers: [WalletsService, AddressService],
  exports: [WalletsService, AddressService],
})
export class WalletsModule {}
